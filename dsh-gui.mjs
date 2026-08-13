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
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const LOG_PATH = join(ROOT, 'dsh-gui.log')
const PID_PATH = join(ROOT, 'dsh-gui.pid')
const URL_LINE = /dsh web: (https?:\/\/\S+)/

/** Parse the launcher's own flags; everything after `--` forwards to the web profile. */
function parseArgs(argv) {
  const options = { port: '0', open: true, exitAfterReady: false, stop: false, help: false, forward: [] }
  let forwarding = false
  for (const arg of argv) {
    if (forwarding) { options.forward.push(arg); continue }
    if (arg === '--') { forwarding = true; continue }
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--no-open') options.open = false
    else if (arg === '--exit-after-ready') options.exitAfterReady = true
    else if (arg === '--stop') options.stop = true
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

/** Kill a leftover server started by a previous gateway run. */
function stopServer() {
  const pid = readPid()
  if (pid === undefined) {
    console.log('dsh gui: no running server (no PID file)')
    return
  }
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'inherit' })
    console.log(result.status === 0 ? `dsh gui: stopped server pid ${pid}` : `dsh gui: could not stop pid ${pid}`)
  } else {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
    console.log(`dsh gui: stopped server pid ${pid}`)
  }
  unlinkSync(PID_PATH)
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
  await new Promise((resolve) => {
    child.on('exit', () => {
      try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
      resolve()
    })
    child.on('error', () => resolve())
  })
}

/** Spawn the harness web server, tee its output, and wait for the readiness line. */
function spawnServer(port, forwarded, audit) {
  const args = ['--import', 'tsx/esm', join(ROOT, 'apps/cli/src/bin.ts'), '--profile', 'web', '--port', port, ...forwarded]
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  writePid(child.pid)
  const urlPromise = new Promise((resolve) => {
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      process.stdout.write(line + '\n')
      audit.write(line + '\n')
      const match = URL_LINE.exec(line)
      if (match !== null) resolve(match[1])
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      audit.write(chunk)
    })
  })
  return { child, url: urlPromise }
}

const HELP = `dsh-gui — DeepSeek Harness desktop window

Usage:
  dsh-gui                    start the server and open the app window
  dsh-gui --port 9527        bind a specific port (default: OS-assigned)
  dsh-gui --no-open          start the server without opening a window
  dsh-gui --stop             stop a leftover server from a previous run
  dsh-gui -- --trusted-host x  forward extra flags to the web profile

The app window uses its own browser profile and closes the server when it is
closed. Ctrl+C in this console also stops everything.
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
  console.log(`dsh gui: booting the DeepSeek Harness web profile${options.port === '0' ? ' on a free port' : ` on port ${options.port}`} …`)
  // The hidden-console launcher (dsh-gui.vbs) makes the gateway's own output
  // invisible; audit gateway and server output alike into the log file.
  const audit = createWriteStream(LOG_PATH, { flags: 'a' })
  const consoleLog = console.log
  const consoleError = console.error
  console.log = (line) => { consoleLog(line); audit.write(line + '\n') }
  console.error = (line) => { consoleError(line); audit.write(line + '\n') }
  const { child, url: serverUrl } = spawnServer(options.port, options.forward, audit)
  let stopping = false
  const shutdown = (code) => {
    stopping = true
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 3000).unref()
    try { unlinkSync(PID_PATH) } catch { /* already gone */ }
    process.exit(code)
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
    if (stopping) {
      try { unlinkSync(PID_PATH) } catch { /* already gone */ }
      process.exit(0)
    }
    console.error(`dsh gui: server exited unexpectedly (code ${code}); see ${LOG_PATH}`)
    process.exit(code ?? 1)
  })
}

main()