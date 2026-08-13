/**
 * Single-writer guard for the `web` profile. A tiny lock file under DSH_HOME
 * records the pid (and, once known, the port/URL) of the currently serving web
 * server. A second `dsh web` boot refuses while the recorded pid is alive,
 * keeping ONE writer per session store — two processes appending the same
 * session is what corrupts its log (seq gaps). Stale locks (dead pid) or
 * `DSH_GUI_FORCE_WEB=1` are taken over automatically. The guard never engages
 * for app `--help`: help boots no server.
 *
 * @module @deepseek-ai/dsh/web-lock
 */
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
/** Lock file name inside DSH_HOME. */
export const WEB_LOCK_NAME = 'dsh-web.lock';
/** Absolute lock-file path. */
export function webLockPath() {
    return dshHomePath(WEB_LOCK_NAME);
}
function readWebLock(path) {
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0)
            return undefined;
        const port = typeof parsed.port === 'number' && Number.isInteger(parsed.port) && parsed.port >= 0 ? parsed.port : undefined;
        return {
            pid: parsed.pid,
            ...(port !== undefined && { port }),
            ...(typeof parsed.url === 'string' && parsed.url.length > 0 && { url: parsed.url }),
            startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
        };
    }
    catch {
        return undefined;
    }
}
/** True when the pid belongs to a live process on this machine. */
function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/** The human-facing location of a lock holder, when one is recorded. */
function holderLocation(record) {
    if (record.url !== undefined)
        return record.url;
    if (record.port !== undefined && record.port > 0)
        return `http://127.0.0.1:${String(record.port)}`;
    return undefined;
}
/** Refusal message naming the live holder and its location. */
function refusalMessage(record) {
    const location = holderLocation(record);
    const suffix = location === undefined ? '' : `。直接打开 ${location} 即可`;
    return `dsh web: 另一个 DeepSeek Harness 服务端已在运行（pid ${String(record.pid)}${location === undefined ? '' : `，${location}`}）${suffix}；同一会话只能有一个 writer，不再启动第二个。如需强制另起一个：设置 DSH_GUI_FORCE_WEB=1 再运行。`;
}
/**
 * Take or verify the single-writer lock before booting the web server.
 * @param port - the port the server intends to bind (0 when OS-assigned).
 * @param force - take over a live holder's lock anyway.
 * @returns `ok` to boot, or `refused` with the holder's pid and location.
 */
export function guardWebServer(port, force = false) {
    const path = webLockPath();
    const existing = readWebLock(path);
    if (existing !== undefined && pidAlive(existing.pid) && !force) {
        return { status: 'refused', message: refusalMessage(existing) };
    }
    rmSync(path, { force: true });
    const record = {
        pid: process.pid,
        ...(port >= 0 && { port }),
        startedAt: new Date().toISOString(),
    };
    try {
        const fd = openSync(path, 'wx');
        closeSync(fd);
        writeFileSync(path, JSON.stringify(record), 'utf8');
    }
    catch (error) {
        // A concurrent boot won the race; defer to the winner when it is alive.
        const raced = readWebLock(path);
        if (raced !== undefined && pidAlive(raced.pid)) {
            return { status: 'refused', message: refusalMessage(raced) };
        }
        throw error;
    }
    process.on('exit', () => releaseWebLock(path));
    return { status: 'ok' };
}
/** Delete the lock file, but only when this process still owns it. */
export function releaseWebLock(path = webLockPath()) {
    const record = readWebLock(path);
    if (record !== undefined && record.pid === process.pid)
        rmSync(path, { force: true });
}
/**
 * Record the announced app URL on the lock held by a known server pid. The
 * booting launcher's own process usually differs from the server process, so
 * the owner pid is passed explicitly.
 * @param url - the readiness-line URL.
 * @param port - the actually bound port.
 * @param ownerPid - the server process that owns the lock.
 * @param path - lock path (defaults to the resolved web lock).
 */
export function setWebLockUrl(url, port, ownerPid, path = webLockPath()) {
    const record = readWebLock(path);
    if (record === undefined || record.pid !== ownerPid)
        return;
    writeFileSync(path, JSON.stringify({ ...record, port, url }), 'utf8');
}
/**
 * Read a live holder's claim, or `undefined` when the lock is absent, stale,
 * or held by a dead process. Launchers use this to attach instead of booting.
 */
export function liveWebLockHolder(path = webLockPath()) {
    const record = readWebLock(path);
    if (record === undefined || !pidAlive(record.pid))
        return undefined;
    return record;
}
/**
 * Extract the web port from the app's inner arguments.
 * @param args - the invocation's inner arguments.
 * @param fallback - default when no `--port` is present.
 * @returns the requested port (0 means OS-assigned).
 */
export function portFromArgs(args, fallback = 3080) {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index] ?? '';
        if (arg === '--port') {
            const value = Number(args[index + 1]);
            if (Number.isInteger(value) && value >= 0)
                return value;
        }
        const assignment = /^--port=(\d+)$/.exec(arg);
        if (assignment !== null)
            return Number(assignment[1]);
    }
    return fallback;
}
//# sourceMappingURL=web-lock.js.map