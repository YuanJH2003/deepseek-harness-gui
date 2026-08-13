#!/usr/bin/env node
/**
 * dsh-gui — standalone desktop GUI gateway for the DeepSeek Harness.
 *
 * Boots the `web` profile (the same server `dsh web` starts) as a child
 * process, waits for its `dsh web: http://…` readiness line, opens the UI in
 * a standalone Edge (or Chrome) app window with its own user-data-dir, and
 * stops the server when that window closes. Closing the console (Ctrl+C) also
 * stops everything; `dsh-gui --stop` kills a leftover server by its PID file.
 *
 * Node is the only runtime dependency; no npm step happens at launch time.
 * @module dsh-gui
 */

import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, rmSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const LOG_PATH = join(ROOT, 'dsh-gui.log')
const PID_PATH = join(ROOT, 'dsh-gui.pid')
const URL_LINE = /dsh web: (https?:\/\/\S+)/
const DEFAULT_WEB_PORT = 3080
// Own AppUserModelID for the app window: the taskbar then shows a separate
// button (never grouped into Edge) whose icon comes from the desktop shortcut
// carrying the same id — the DeepSeek whale — instead of the Edge logo.
const APP_USER_MODEL_ID = 'DeepSeekHarnessGUI'
// Sentinel: a live lock holder claims a server but it is unreachable; the
// gateway must not start a second writer.
const REFUSED = Symbol('dsh-gui-refused')
// How long detectRunningHarness waits for a live-but-unreachable lock holder
// to finish winding down (usually a just-closed window's server) before
// refusing, and how often it re-checks.
const RETRY_HOLDER_MS = 8000
const RETRY_HOLDER_STEP_MS = 400
/** Local clock stamp for audit-log lines (the log otherwise has no times). */
const ts = () => new Date().toTimeString().slice(0, 8)

// The single-writer lock mirrors apps/cli/src/web-lock.ts (replicated here so
// this standalone launcher stays dependency-free). Two servers appending the
// same session store is what corrupts session logs, so the gateway attaches to
// a live holder instead of booting a second server.
function webLockPath() {
  // Must mirror @deepseek-ai/dsh-home-paths exactly: the harness home is
  // $DSH_HOME when set and non-blank, otherwise ~/.dsh. (Using homedir()
  // directly here made the gateway read a different lock file than the CLI
  // does, so it never saw a live holder and its child got refused silently —
  // the "first click does nothing" symptom.)
  const fromEnv = process.env.DSH_HOME
  const home = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return join(home, 'dsh-web.lock')
}

function readWebLock() {
  try {
    const parsed = JSON.parse(readFileSync(webLockPath(), 'utf8'))
    if (typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 0) return parsed
  } catch {
    /* absent or unparsable: treated as no holder */
  }
  return undefined
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Record the announced URL on the lock held by a known server pid. */
function setWebLockUrl(url, port, ownerPid) {
  const record = readWebLock()
  if (record === undefined || record.pid !== ownerPid) return
  writeFileSync(webLockPath(), JSON.stringify({ ...record, port, url }), 'utf8')
}

/**
 * Remove the lock file when it still belongs to a known server pid. The
 * server releases its lock on clean exit; when it had to be force-killed
 * (graceful shutdown stalled), the gateway clears the stale claim instead.
 */
function clearLockOf(ownerPid) {
  const record = readWebLock()
  if (record !== undefined && record.pid === ownerPid) {
    try { rmSync(webLockPath(), { force: true }) } catch { /* best effort */ }
  }
}

/** True when a DeepSeek Harness server is already answering on the given port. */
async function probeHarnessOn(port) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1200)
    const response = await fetch(`http://127.0.0.1:${port}/api/session.list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', method: 'session.list', rpcId: 'dsh-gui-probe', payload: {} }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) return false
    const text = await response.text()
    return typeof text === 'string' && text.includes('"result"')
  } catch {
    return false
  }
}

/**
 * Return the URL of an already-running harness web server, the REFUSED
 * sentinel when a live lock holder is unreachable, or undefined. A read-only
 * probe: opens no session and writes nothing to the session store.
 */
async function detectRunningHarness() {
  // A live but unreachable holder is usually a just-closed window's server
  // still winding down (graceful stop can take a few seconds before the lock
  // is released). Wait for it instead of failing the click immediately.
  const start = Date.now()
  while (true) {
    if (await probeHarnessOn(DEFAULT_WEB_PORT)) return `http://127.0.0.1:${DEFAULT_WEB_PORT}`
    const holder = readWebLock()
    if (holder === undefined || !pidAlive(holder.pid)) return undefined
    const candidate = holder.url ?? (holder.port !== undefined && holder.port > 0
      ? `http://127.0.0.1:${String(holder.port)}`
      : undefined)
    if (candidate !== undefined) {
      const port = Number(new URL(candidate).port)
      if (port > 0 && (await probeHarnessOn(port))) return candidate
    }
    if (Date.now() - start >= RETRY_HOLDER_MS) break
    await new Promise((resolve) => setTimeout(resolve, RETRY_HOLDER_STEP_MS))
  }
  // Starting a second server while a live claim exists would create the
  // dual-writer hazard the lock exists to prevent.
  console.error(`dsh gui: another server is claimed running (pid ${String(readWebLock()?.pid ?? '?')}) but unreachable`)
  console.error('dsh gui: run dsh-gui --stop to end a leftover server, or force a second one with --parallel')
  return REFUSED
}

/** Parse the launcher's own flags; everything after `--` forwards to the web profile. */
function parseArgs(argv) {
  const options = { port: '0', open: true, exitAfterReady: false, stop: false, help: false, parallel: false, forward: [] }
  let forwarding = false
  for (const arg of argv) {
    if (forwarding) { options.forward.push(arg); continue }
    if (arg === '--') { forwarding = true; continue }
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--no-open') options.open = false
    else if (arg === '--exit-after-ready') options.exitAfterReady = true
    else if (arg === '--stop') options.stop = true
    else if (arg === '--parallel') options.parallel = true
    else if (arg === '--port') { const value = argv[argv.indexOf(arg) + 1]; if (value === undefined) throw new Error('--port needs a number'); argv.splice(argv.indexOf(arg), 1); options.port = value }
    else if (/^--port=/.test(arg)) options.port = arg.slice('--port='.length)
    else throw new Error(`unknown option ${arg} (see --help)`)
  }
  return options
}

/** First installed Chromium-family browser, or undefined. */
function findBrowser() {
  const candidates = process.platform === 'win32'
    ? [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      join(process.env.LOCALAPPDATA ?? '', 'Microsoft\\Edge\\Application\\msedge.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Chrome\\Application\\chrome.exe',
    ]
    : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return candidates.find(candidate => existsSync(candidate))
}

/** Write the gateway's current server PID for `--stop`. */
function writePid(pid) {
  writeFileSync(PID_PATH, `${pid}\n`, 'utf8')
}

function readPid() {
  try {
    const raw = readFileSync(PID_PATH, 'utf8').trim()
    const parsed = Number(raw)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Kill a leftover server started by a previous gateway run (PID file or lock). */
function stopServer() {
  let pid = readPid()
  if (pid === undefined) {
    // The PID file may be gone (e.g. a crash, or a server started outside the
    // gateway); the single-writer lock still names the live server.
    const holder = readWebLock()
    if (holder !== undefined && pidAlive(holder.pid)) pid = holder.pid
  }
  if (pid === undefined) {
    console.log('dsh gui: no running server (no PID file, no lock holder)')
    return
  }
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'inherit' })
    console.log(result.status === 0 ? `dsh gui: stopped server pid ${pid}` : `dsh gui: could not stop pid ${pid}`)
  } else {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
    console.log(`dsh gui: stopped server pid ${pid}`)
  }
  try { unlinkSync(PID_PATH) } catch { /* already gone */ }
  // A hard-killed server could not release its lock; clear the stale claim.
  // Only when the lock still names the process we just stopped.
  try {
    const record = readWebLock()
    if (record !== undefined && record.pid === pid) rmSync(webLockPath(), { force: true })
  } catch { /* best effort */ }
}

/**
 * Open the UI in a standalone app window and resolve when the window closes.
 * The dedicated user-data-dir makes this Edge instance own the window, so its
 * process exit is the window-close signal. Extensions and account sync are
 * disabled: a fresh profile otherwise inherits the user's synced extensions
 * (e.g. a userscript manager) which open onboarding pages (docs.scriptcat.org
 * open-dev, install_comple) on every launch.
 */
async function openAppWindow(url) {
  const browser = findBrowser()
  if (browser === undefined) {
    // No Chromium-family browser: let the default browser handle the URL and
    // keep the gateway alive until the console closes.
    console.log(`dsh gui: no Edge/Chrome found; opening ${url} in the default browser`)
    if (process.platform === 'win32') spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' })
    return new Promise(() => {}) // never resolves on purpose
  }
  const profileDir = join(tmpdir(), `dsh-gui-window-${process.pid}`)
  // Defensive: remove a leftover profile left by a hard-killed previous run
  // whose process id was recycled onto this gateway.
  rmSync(profileDir, { recursive: true, force: true })
  const debugPort = process.env.DSH_GUI_DEBUG_PORT
  const child = spawn(browser, [
    `--app=${url}`,
    '--window-size=1366,900',
    `--user-data-dir=${profileDir}`,
    `--app-user-model-id=${APP_USER_MODEL_ID}`,
    '--no-first-run',
    '--disable-first-run-ui',
    '--disable-extensions',
    '--disable-sync',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-features=msEdgeFirstRunExperience',
    ...(debugPort === undefined ? [] : [`--remote-debugging-port=${debugPort}`]),
  ], { stdio: 'ignore' })
  console.log(`dsh gui: app window opened (${browser})`)
  // Best-effort: repaint the window's icon to the whale. Edge ignores the
  // AppUserModelID->shortcut icon association for --app windows, so patch the
  // window directly (WM_SETICON + class icon, cross-process) a few times
  // while the window shows up. The profile-dir marker lets the script find
  // whichever Edge process actually owns the window. Silent no-op on failure.
  if (process.platform === 'win32') {
    const patchIcon = () => spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        join(ROOT, 'dsh-gui-taskbar-icon.ps1'),
        '-ProcessId', String(child.pid), '-IconPath', join(ROOT, 'dsh-gui.ico'),
        '-ProfileDir', profileDir],
      { stdio: 'ignore', windowsHide: true },
    )
    let attempts = 0
    const timer = setInterval(() => {
      if (++attempts > 12) { clearInterval(timer); return }
      patchIcon()
    }, 1500)
    child.on('exit', () => clearInterval(timer))
  }
  await new Promise((resolve) => {
    child.on('exit', () => {
      try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
      resolve()
    })
    child.on('error', () => resolve())
  })
}

/** Spawn the harness web server, tee its output, and wait for the readiness line. */
function spawnServer(port, forwarded, audit, force) {
  // Prefer the compiled CLI: cold boot drops from ~22s (tsx transpiling TS on
  // the fly) to ~1-2s. Fall back to the TS source via tsx when a fresh copy
  // has no build yet.
  const compiled = join(ROOT, 'apps/cli/lib/bin.js')
  const bin = existsSync(compiled) ? compiled : join(ROOT, 'apps/cli/src/bin.ts')
  const args = bin.endsWith('.ts')
    ? ['--import', 'tsx/esm', bin, '--profile', 'web', '--port', port, ...forwarded]
    : [bin, '--profile', 'web', '--port', port, ...forwarded]
  const env = force === true ? { ...process.env, DSH_GUI_FORCE_WEB: '1' } : process.env
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env })
  writePid(child.pid)
  const urlPromise = new Promise((resolve) => {
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      process.stdout.write(line + '\n')
      audit.write(`[${ts()}] ${line}\n`)
      const match = URL_LINE.exec(line)
      if (match !== null) {
        const url = match[1]
        const boundPort = Number(new URL(url).port)
        if (Number.isInteger(boundPort) && boundPort > 0) setWebLockUrl(url, boundPort, child.pid)
        resolve(url)
      }
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      audit.write(`[${ts()}] ${String(chunk)}`)
    })
  })
  return { child, url: urlPromise }
}

const HELP = `dsh-gui — DeepSeek Harness desktop window

Usage:
  dsh-gui                    connect to a running server (default port 3080),
                             or start one on a free port and open the window
  dsh-gui --port 9527        bind a specific port (starts an own server;
                             neither attach mode nor the single-writer guard)
  dsh-gui --parallel         force a second server even if one is running
  dsh-gui --no-open          probe/attach only, or start without a window
  dsh-gui --stop             stop a leftover server from a previous run
  dsh-gui -- --trusted-host x  forward extra flags to the web profile

If a harness server is already running, the window attaches to it instead of
starting a second server: two processes writing the same active session is what
corrupts session logs (seq gaps). Attaching keeps one writer.
`

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`dsh gui: ${error.message}`)
    console.error(HELP)
    process.exit(2)
  }
  if (options.help) {
    console.log(HELP)
    return
  }
  if (options.stop) {
    stopServer()
    return
  }
  // The hidden-console launcher (dsh-gui.vbs) makes the gateway's own output
  // invisible; audit gateway and server output alike into the log file.
  const audit = createWriteStream(LOG_PATH, { flags: 'a' })
  const consoleLog = console.log
  const consoleError = console.error
  console.log = (line) => { consoleLog(line); audit.write(`[${ts()}] ${line}\n`) }
  console.error = (line) => { consoleError(line); audit.write(`[${ts()}] ${line}\n`) }

  void (async () => {
    // Single-writer guard: a second process writing the same live session is
    // what corrupts its log (seq gap in committed region). When a harness
    // server is already up, attach to it instead of booting another one —
    // unless the user explicitly wants an own server (--parallel / --port).
    const existing = options.parallel || options.port !== '0'
      ? undefined
      : await detectRunningHarness()
    if (existing === REFUSED) {
      process.exit(1)
    }
    if (existing !== undefined) {
      console.log(`dsh gui: another DeepSeek Harness server is already running at ${existing}`)
      console.log('dsh gui: attaching to it instead of starting a second server (keeps one writer per session)')
      if (!options.open || options.exitAfterReady) {
        console.log(`dsh gui: ready at ${existing}`)
        return
      }
      console.log(`dsh gui: opening ${existing} in an app window; closing it will not stop the shared server`)
      await openAppWindow(existing)
      console.log('dsh gui: app window closed (shared server kept running)')
      return
    }
    runOwnServer(options, audit)
  })()
}

/** Boot an own harness server behind the gateway and manage its lifecycle. */
function runOwnServer(options, audit) {
  console.log(`dsh gui: booting the DeepSeek Harness web profile${options.port === '0' ? ' on a free port' : ` on port ${options.port}`} …`)
  // An explicit --port is an explicit request for an own server: bypass the
  // single-writer lock the same way --parallel does.
  const { child, url: serverUrl } = spawnServer(options.port, options.forward, audit, options.parallel || options.port !== '0')
  let stopping = false
  let exitCode = 0
  const shutdown = (code) => {
    stopping = true
    exitCode = code
    try { unlinkSync(PID_PATH) } catch { /* already gone */ }
    // Never exit while the server child is alive: an orphan keeps the
    // single-writer lock and keeps appending the session store. Give the
    // graceful SIGTERM a moment, then hard-kill; the child's 'exit' below
    // finally exits this gateway with `exitCode`.
    const grace = setTimeout(() => {
      child.kill('SIGKILL')
      const lastResort = setTimeout(() => process.exit(exitCode), 2000)
      lastResort.unref()
    }, 4000)
    grace.unref()
  }
  process.on('SIGINT', () => shutdown(130))
  process.on('SIGTERM', () => shutdown(143))
  if (options.exitAfterReady) {
    void serverUrl.then((url) => {
      console.log(`dsh gui: ready at ${url}`)
      stopping = true
      child.kill('SIGTERM')
    })
  }
  void serverUrl.then(async (url) => {
    if (!options.open || options.exitAfterReady) return
    console.log(`dsh gui: ready at ${url}`)
    await openAppWindow(url)
    console.log('dsh gui: app window closed; stopping the server')
    shutdown(0)
  })
  serverUrl.catch(() => {
    console.error('dsh gui: server did not become ready')
    shutdown(1)
  })
  child.on('exit', (code) => {
    // Belt-and-braces: if the server was force-killed, its own exit hook
    // could not release the single-writer lock; clear the stale claim here.
    clearLockOf(child.pid)
    if (stopping) {
      try { unlinkSync(PID_PATH) } catch { /* already gone */ }
      process.exit(exitCode)
    }
    if (code === 0) {
      // A clean early exit means the web-profile guard declined to start a
      // second server; the refusal message is already on the console.
      process.exit(0)
    }
    console.error(`dsh gui: server exited unexpectedly (code ${code}); see ${LOG_PATH}`)
    process.exit(code ?? 1)
  })
}

main()