import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
//#region lib/types/web-lock.js
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
/** Lock file name inside DSH_HOME. */
const WEB_LOCK_NAME = "dsh-web.lock";
/** Absolute lock-file path. */
function webLockPath() {
	return dshHomePath(WEB_LOCK_NAME);
}
function readWebLock(path) {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return void 0;
		const port = typeof parsed.port === "number" && Number.isInteger(parsed.port) && parsed.port >= 0 ? parsed.port : void 0;
		return {
			pid: parsed.pid,
			...port !== void 0 && { port },
			...typeof parsed.url === "string" && parsed.url.length > 0 && { url: parsed.url },
			startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : ""
		};
	} catch {
		return;
	}
}
/** True when the pid belongs to a live process on this machine. */
function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
/** The human-facing location of a lock holder, when one is recorded. */
function holderLocation(record) {
	if (record.url !== void 0) return record.url;
	if (record.port !== void 0 && record.port > 0) return `http://127.0.0.1:${String(record.port)}`;
}
/** Refusal message naming the live holder and its location. */
function refusalMessage(record) {
	const location = holderLocation(record);
	const suffix = location === void 0 ? "" : `。直接打开 ${location} 即可`;
	return `dsh web: 另一个 DeepSeek Harness 服务端已在运行（pid ${String(record.pid)}${location === void 0 ? "" : `，${location}`}）${suffix}；同一会话只能有一个 writer，不再启动第二个。如需强制另起一个：设置 DSH_GUI_FORCE_WEB=1 再运行。`;
}
/**
* Take or verify the single-writer lock before booting the web server.
* @param port - the port the server intends to bind (0 when OS-assigned).
* @param force - take over a live holder's lock anyway.
* @returns `ok` to boot, or `refused` with the holder's pid and location.
*/
function guardWebServer(port, force = false) {
	const path = webLockPath();
	const existing = readWebLock(path);
	if (existing !== void 0 && pidAlive(existing.pid) && !force) return {
		status: "refused",
		message: refusalMessage(existing)
	};
	rmSync(path, { force: true });
	const record = {
		pid: process.pid,
		...port >= 0 && { port },
		startedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	try {
		closeSync(openSync(path, "wx"));
		writeFileSync(path, JSON.stringify(record), "utf8");
	} catch (error) {
		const raced = readWebLock(path);
		if (raced !== void 0 && pidAlive(raced.pid)) return {
			status: "refused",
			message: refusalMessage(raced)
		};
		throw error;
	}
	process.on("exit", () => releaseWebLock(path));
	return { status: "ok" };
}
/** Delete the lock file, but only when this process still owns it. */
function releaseWebLock(path = webLockPath()) {
	const record = readWebLock(path);
	if (record !== void 0 && record.pid === process.pid) rmSync(path, { force: true });
}
/**
* Extract the web port from the app's inner arguments.
* @param args - the invocation's inner arguments.
* @param fallback - default when no `--port` is present.
* @returns the requested port (0 means OS-assigned).
*/
function portFromArgs(args, fallback = 3080) {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] ?? "";
		if (arg === "--port") {
			const value = Number(args[index + 1]);
			if (Number.isInteger(value) && value >= 0) return value;
		}
		const assignment = /^--port=(\d+)$/.exec(arg);
		if (assignment !== null) return Number(assignment[1]);
	}
	return fallback;
}
//#endregion
export { guardWebServer, portFromArgs };
