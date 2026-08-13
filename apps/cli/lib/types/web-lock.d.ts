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
export declare const WEB_LOCK_NAME = "dsh-web.lock";
/** The durable claim of one web-server process. */
export interface WebLockRecord {
    /** Server process id that took the lock. */
    pid: number;
    /** Port requested at boot; 0 when the OS assigns one at bind time. */
    port?: number;
    /** Canonical app URL once the server announces itself; filled by launchers that observe the readiness line. */
    url?: string;
    startedAt: string;
}
/** Absolute lock-file path. */
export declare function webLockPath(): string;
/**
 * Take or verify the single-writer lock before booting the web server.
 * @param port - the port the server intends to bind (0 when OS-assigned).
 * @param force - take over a live holder's lock anyway.
 * @returns `ok` to boot, or `refused` with the holder's pid and location.
 */
export declare function guardWebServer(port: number, force?: boolean): {
    status: 'ok';
} | {
    status: 'refused';
    message: string;
};
/** Delete the lock file, but only when this process still owns it. */
export declare function releaseWebLock(path?: string): void;
/**
 * Record the announced app URL on the lock held by a known server pid. The
 * booting launcher's own process usually differs from the server process, so
 * the owner pid is passed explicitly.
 * @param url - the readiness-line URL.
 * @param port - the actually bound port.
 * @param ownerPid - the server process that owns the lock.
 * @param path - lock path (defaults to the resolved web lock).
 */
export declare function setWebLockUrl(url: string, port: number, ownerPid: number, path?: string): void;
/**
 * Read a live holder's claim, or `undefined` when the lock is absent, stale,
 * or held by a dead process. Launchers use this to attach instead of booting.
 */
export declare function liveWebLockHolder(path?: string): WebLockRecord | undefined;
/**
 * Extract the web port from the app's inner arguments.
 * @param args - the invocation's inner arguments.
 * @param fallback - default when no `--port` is present.
 * @returns the requested port (0 means OS-assigned).
 */
export declare function portFromArgs(args: readonly string[], fallback?: number): number;
//# sourceMappingURL=web-lock.d.ts.map