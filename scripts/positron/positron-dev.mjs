#!/usr/bin/env node
// positron-dev - a terminal dashboard for Positron's build daemons + dev launches.
//
// Replaces the VS Code "Positron - Build" task (Cmd+Shift+B): starts or attaches
// the four watch daemons, shows their status and logs in tabs you can leave open,
// and offers one-key launches of the dev builds (Electron, Electron + Assistant,
// web server, browser).
//
// Zero dependencies - Node built-ins only. Run from inside any Positron checkout
// (the checkout is found by walking up from the cwd), or pass one explicitly:
// `positron-dev [path-to-checkout]`.
// With a sibling `assistant` checkout (`../assistant` - the same layout the
// "Positron (with Assistant)" F5 target expects) an Assistant card joins the
// grid, running the assistant repo's `npm run watch:positron` as a daemon.
//
// Keys: 1-N or arrows select | e electron | a electron+assistant | w web server
//       b open browser  | r restart daemon | k kill selected (daemon or app)
//       K kill all daemons | i npm install | s start all | ? help | q quit
// The footer advertises only the keys that apply to the selected card; ? shows
// the full table. All keys work regardless of selection.
//
// Non-interactive: `positron-dev status [--json] [checkout]` prints a one-shot
// snapshot of daemon/app state (for agents and scripts) and exits.
//
// --- Running and installing -------------------------------------------------
//
// This file is self-contained (Node built-ins only, any recent Node; no npm
// install of its own, no build step). You can always run it in place:
//
//     ./scripts/positron/positron-dev.mjs              # interactive dashboard
//     ./scripts/positron/positron-dev.mjs status       # one-shot snapshot, no TTY needed
//
// To make a global `positron-dev` command, symlink this file onto your PATH.
// If you are an AI agent asked to install this, do exactly that (macOS/Linux):
//
//   1. Symlink from the user's MAIN Positron checkout - not a throwaway
//      worktree that may be deleted later. Symlink, don't copy, so the
//      command stays current as the repo updates:
//
//        ln -sf "$(pwd)/scripts/positron/positron-dev.mjs" ~/.local/bin/positron-dev
//
//   2. If ~/.local/bin is not on PATH (check: `command -v positron-dev`),
//      create it with mkdir -p and add `export PATH="$HOME/.local/bin:$PATH"`
//      to the user's shell rc (~/.zshrc or ~/.bashrc). Prefer an existing
//      on-PATH bin dir (e.g. ~/bin) if the user already has one.
//
//   3. Verify from inside any Positron checkout: `positron-dev status`.
//
// The command acts on whichever checkout you run it FROM (found by walking up
// from the cwd, or passed as an argument) - not on the checkout the symlink
// points into. One install covers every worktree. Windows is not supported
// (the launches drive code.sh / code-server.sh).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

// ============================================================================
// S1. Constants + ANSI helpers
// ============================================================================

const ESC = '\x1b';
const CSI = ESC + '[';
const ALT_ON = CSI + '?1049h';
const ALT_OFF = CSI + '?1049l';
const CUR_HIDE = CSI + '?25l';
const CUR_SHOW = CSI + '?25h';
const CLEAR = CSI + '2J';
const HOME = CSI + 'H';
const EOL = CSI + 'K'; // clear to end of line

const C = {
  reset: CSI + '0m',
  bold: CSI + '1m',
  dim: CSI + '2m',
  inverse: CSI + '7m',
  red: CSI + '31m',
  green: CSI + '32m',
  yellow: CSI + '33m',
  blue: CSI + '34m',
  magenta: CSI + '35m',
  cyan: CSI + '36m',
  gray: CSI + '90m',
};

const DOT = '●'; // filled circle for status
const SPINNER = ['◜', '◝', '◞', '◟']; // quadrant arcs
const RULE = '─'; // horizontal line

// Strip ANSI escape sequences (CSI, OSC) so ring/width math works on plain text.
function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC
    .replace(/\x1b[@-Z\\-_]/g, '') // single-char escapes (incl. ESC c reset)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ''); // CSI
}

// Visible length of a string that may contain our own color codes.
function visLen(s) {
  return stripAnsi(s).length;
}

// Truncate a plain (already stripped) string to a column budget, expanding tabs.
function clip(s, cols) {
  s = s.replace(/\t/g, '  ');
  return s.length <= cols ? s : s.slice(0, cols);
}

// ============================================================================
// S2. Checkout discovery
// ============================================================================

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function realpathSafe(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function isPositronCheckout(dir) {
  return (
    fs.existsSync(path.join(dir, 'scripts', 'code.sh')) &&
    readJsonSafe(path.join(dir, 'product.json'))?.nameShort === 'Positron'
  );
}

function findCheckoutFromCwd(startDir) {
  let d = startDir;
  for (;;) {
    if (isPositronCheckout(d)) return d;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

function displayPath(p) {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

// ============================================================================
// S3. deemon plumbing - mirror getIPCHandle so we can probe daemons w/o touching
// ============================================================================

function daemonSocket(checkout, args) {
  const hash = crypto
    .createHash('md5')
    .update('npm')
    .update(args.toString())
    .update(checkout)
    .digest('hex');
  const dir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(dir, `daemon-${hash}.sock`);
}

function daemonExists(checkout, args) {
  return fs.existsSync(daemonSocket(checkout, args));
}

// ============================================================================
// S4. LineFeeder + RingBuffer
// ============================================================================

// Splits a byte stream into ANSI-stripped lines, carrying partial lines across
// chunks. Collapses CR / CRLF to LF so progress rewrites become discrete lines.
class LineFeeder {
  constructor(onLine) {
    this.onLine = onLine;
    this.buf = '';
  }
  push(chunk) {
    this.buf += chunk.toString('utf8').replace(/\r\n?/g, '\n');
    const parts = this.buf.split('\n');
    this.buf = parts.pop();
    for (const p of parts) this.onLine(stripAnsi(p));
    // Guard against an unterminated line growing without bound.
    if (this.buf.length > 65536) {
      this.onLine(stripAnsi(this.buf));
      this.buf = '';
    }
  }
}

class Ring {
  constructor(max = 2000) {
    this.max = max;
    this.lines = [];
  }
  push(line) {
    this.lines.push(line);
    // Trim only once we're well over cap so front-splices amortize to O(1);
    // matters when a daemon replays a large buffer on attach.
    if (this.lines.length > this.max * 2) this.lines.splice(0, this.lines.length - this.max);
  }
  tail(n) {
    return this.lines.slice(Math.max(0, this.lines.length - n));
  }
  clear() {
    this.lines = [];
  }
}

// ============================================================================
// S5. Watcher manager
// ============================================================================

// State per watcher: no-deps | no-daemon | attaching | compiling | ok | errors
//                    | running | stopped
const WATCHER_DEFS = [
  {
    label: 'Transpile',
    args: ['run', 'watch-client-transpile'],
    begins: /Starting transpilation/,
    ends: /Finished transpilation with/,
  },
  {
    label: 'Typecheck',
    args: ['run', 'watch-client'],
    begins: /Starting compilation/,
    ends: /Finished compilation with/,
  },
  {
    label: 'Ext Build',
    args: ['run', 'watch-extensions'],
    begins: /Starting compilation/,
    ends: /Finished compilation/,
  },
  {
    label: 'Copilot',
    args: ['run', 'watch-copilot'],
    // Copilot has no problem matcher in tasks.json, but its watch runs
    // extensions/copilot/.esbuild.ts which logs these exact markers.
    begins: /\[watch\] build started/,
    ends: /\[watch\] build finished/,
    heuristic: true,
  },
];

// The assistant watch (sibling assistant checkouts only) is not deemon-wrapped
// in its own repo, so we wrap it in the Positron checkout's deemon copy with
// cwd set to the assistant dir. deemon's requires resolve relative to its own
// location, and the daemon key hashes cwd, so this yields a stable per-sibling
// daemon with the same attach/replay/kill semantics as the Positron watchers.
// Output is concurrently-multiplexed esbuild + tsc; tsc's "Found N errors."
// is the authoritative verdict and lands last, so the combined regexes below
// converge on it (heuristic, like Copilot).
function assistantWatcherDef(assistantDir) {
  return {
    label: 'Assistant',
    args: ['run', 'watch:positron'],
    cwd: assistantDir,
    begins: /build started|File change detected|Starting compilation in watch mode/,
    ends: /build finished|Found \d+ errors?\. Watching for/,
    heuristic: true,
    // Starting this card spawns a real npm watch in the assistant repo, so it
    // only auto-attaches when its daemon already exists; s or r starts it.
    manualStart: true,
  };
}

let CHECKOUT = null;
let DEEMON_BIN = null;
let watchers = [];

function buildWatchers(checkout, assistantDirOverride) {
  DEEMON_BIN = path.join(checkout, 'node_modules', 'deemon', 'src', 'deemon.js');
  const defs = WATCHER_DEFS.map((d) => ({ ...d, cwd: checkout }));
  const assistantDir = assistantDirOverride ?? siblingAssistantDir(checkout);
  if (assistantDir) defs.push(assistantWatcherDef(assistantDir));
  watchers = defs.map((d, i) => ({
    ...d,
    key: String(i + 1),
    state: 'no-daemon',
    errorCount: 0,
    statusLine: '', // last begins/ends line, for the card summary
    verdictAt: null, // when the last live-observed verdict landed
    replaying: true, // attach replays old output; don't timestamp/alert on it
    ring: new Ring(),
    child: null,
    feeder: null,
    detaching: false,
  }));
}

function hasDeemon() {
  return fs.existsSync(DEEMON_BIN);
}

function ingestWatcherLine(w, line) {
  w.ring.push(line);
  if (w.begins && w.begins.test(line)) {
    w.state = 'compiling';
    w.statusLine = line;
  } else if (w.ends && w.ends.test(line)) {
    const wasErrors = w.state === 'errors';
    const m = /(?:with|Found) (\d+) error/.exec(line);
    if (m && Number(m[1]) > 0) {
      w.state = 'errors';
      w.errorCount = Number(m[1]);
      if (!wasErrors) notifyBreak(w);
    } else {
      w.state = 'ok';
      w.errorCount = 0;
    }
    if (!w.replaying) w.verdictAt = Date.now();
    w.statusLine = line;
  } else if (/\[deemon\] Build daemon exited/.test(line)) {
    if (!w.detaching) w.state = 'stopped';
  } else if (/\[deemon\] (Spawned|Attached to running)/.test(line)) {
    // The replay (with any Starting/Finished lines) has already been processed
    // by now; only fall through to a generic state if nothing set one.
    w.replaying = false;
    if (w.state === 'attaching') w.state = w.heuristic ? 'running' : 'compiling';
  }
  invalidate();
}

// A watcher just flipped to errors on a live build: ring the terminal bell
// and (on macOS) pop a notification, so a backgrounded dashboard still taps
// you on the shoulder. Replayed/probed output never alerts.
function notifyBreak(w) {
  if (HEADLESS || PREVIEW || w.replaying) return;
  process.stdout.write('\x07');
  if (process.platform !== 'darwin') return;
  const msg = `${w.label}: ${w.errorCount} error${w.errorCount === 1 ? '' : 's'}`;
  const script = `display notification ${JSON.stringify(msg)} with title "positron-dev" subtitle ${JSON.stringify(path.basename(CHECKOUT))}`;
  try {
    spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* notification is best-effort */
  }
}

function attachWatcher(w) {
  if (!hasDeemon()) {
    w.state = 'no-deps';
    if (!w.ring.lines.length) {
      w.ring.push('[positron-dev] node_modules/deemon missing - run "npm ci" in this checkout.');
    }
    invalidate();
    return;
  }
  if (w.child) return; // already attached
  w.detaching = false;
  w.replaying = true;
  w.state = 'attaching';
  w.feeder = new LineFeeder((line) => ingestWatcherLine(w, line));
  const child = spawn(process.execPath, [DEEMON_BIN, 'npm', ...w.args], {
    cwd: w.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  w.child = child;
  child.stdout.on('data', (d) => w.feeder.push(d));
  child.stderr.on('data', (d) => w.feeder.push(d));
  child.on('exit', () => {
    w.child = null;
    if (!w.detaching && w.state !== 'no-daemon') w.state = 'stopped';
    invalidate();
  });
  child.on('error', (err) => {
    w.ring.push(`[positron-dev] failed to start client: ${err.message}`);
    w.state = 'stopped';
    invalidate();
  });
  invalidate();
}

// Detach our client; the daemon keeps running.
function detachWatcher(w) {
  if (!w.child) return;
  w.detaching = true;
  const child = w.child;
  try {
    child.stdin.write('\x03');
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }, 500);
}

// Kill the underlying daemon (not just our client), then call cb.
function killWatcher(w, cb) {
  w.detaching = true; // our client's exit shouldn't flip us to 'stopped'
  const finish = () => {
    if (w.child) {
      const child = w.child;
      try {
        child.stdin.write('\x03');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 300);
    }
    w.state = 'no-daemon';
    w.errorCount = 0;
    w.ring.push('[positron-dev] daemon killed');
    invalidate();
    cb && cb();
  };
  if (hasDeemon() && daemonExists(w.cwd, w.args)) {
    const killer = spawn(process.execPath, [DEEMON_BIN, '--attach', '--kill', 'npm', ...w.args], {
      cwd: w.cwd,
      stdio: 'ignore',
      env: process.env,
    });
    killer.on('exit', finish);
    killer.on('error', finish);
  } else {
    finish();
  }
}

function restartWatcher(w) {
  killWatcher(w, () => setTimeout(() => attachWatcher(w), 300));
}

function startAll() {
  for (const w of watchers) if (!w.child) attachWatcher(w);
  setStatus('starting/attaching all daemons');
}

function killAll() {
  for (const w of watchers) killWatcher(w);
  setStatus('killing all daemons');
}

// ============================================================================
// S6. App launcher (electron / +assistant / web / browser)
// ============================================================================

let STATE_DIR = null;
let apps = {};

function initApps(checkout) {
  const slug = checkout.replace(/[^\w.-]+/g, '_').replace(/^_+/, '');
  STATE_DIR = path.join(os.homedir(), '.positron-dev', slug);
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
  apps = {
    electron: makeApp(String(watchers.length + 1), 'electron', 'Electron', null),
    web: makeApp(String(watchers.length + 2), 'web', 'Web', /Web UI available at/),
  };
}

function makeApp(key, name, label, readyRe) {
  return {
    key,
    name,
    label,
    readyRe,
    state: 'idle', // idle | launching | running | ready | exited
    since: null, // when the current process was launched
    ring: new Ring(),
    logPath: null,
    pid: null,
    tailTimer: null,
    tailPos: 0,
    feeder: null,
  };
}

function appLogPath(app) {
  return path.join(STATE_DIR, `${app.name}.log`);
}

function appPidPath(app) {
  return path.join(STATE_DIR, `${app.name}.pid`);
}

function newAppFeeder(app) {
  return new LineFeeder((line) => {
    app.ring.push(line);
    if (app.readyRe && app.readyRe.test(line)) app.state = 'ready';
    invalidate();
  });
}

function appendLog(app, text) {
  try {
    fs.appendFileSync(app.logPath, text);
  } catch {
    /* ignore */
  }
}

function startTail(app, fromPos) {
  stopTail(app);
  app.tailPos = fromPos ?? 0;
  const poll = () => {
    fs.stat(app.logPath, (err, st) => {
      if (err) return;
      if (st.size < app.tailPos) app.tailPos = 0; // truncated
      if (st.size <= app.tailPos) return;
      const stream = fs.createReadStream(app.logPath, { start: app.tailPos, end: st.size - 1 });
      const start = app.tailPos;
      let buf = Buffer.alloc(0);
      stream.on('data', (d) => (buf = Buffer.concat([buf, d])));
      stream.on('end', () => {
        // Only advance if nothing reset us mid-read.
        if (app.tailPos === start) app.tailPos = st.size;
        app.feeder.push(buf);
      });
      stream.on('error', () => {});
    });
  };
  app.tailTimer = setInterval(poll, 300);
}

function stopTail(app) {
  if (app.tailTimer) {
    clearInterval(app.tailTimer);
    app.tailTimer = null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function beginAppLaunch(app) {
  app.logPath = appLogPath(app);
  try {
    fs.writeFileSync(app.logPath, ''); // truncate
  } catch {
    /* ignore */
  }
  app.ring.clear();
  app.feeder = newAppFeeder(app);
  app.state = 'launching';
  startTail(app, 0);
}

// Sibling assistant checkout (the ../assistant layout the F5 target expects),
// or null if there is none.
function siblingAssistantDir(checkout) {
  const sibling = path.join(path.dirname(checkout), 'assistant');
  return fs.existsSync(path.join(sibling, 'packages', 'positron')) ? sibling : null;
}

// For the `a` launch: the direct sibling if present, else the nearest `assistant`
// checkout found next to any ancestor of the checkout (covers worktrees living
// under <root>/positron.worktrees/* with the assistant clone at <root>/assistant).
function assistantDirFor(checkout) {
  for (let d = checkout; ; ) {
    const parent = path.dirname(d);
    if (parent === d) return path.join(path.dirname(checkout), 'assistant');
    const cand = path.join(parent, 'assistant');
    if (fs.existsSync(path.join(cand, 'packages', 'positron'))) return cand;
    d = parent;
  }
}

function spawnAppProcess(app, cmd, args, cwd) {
  let fd;
  try {
    fd = fs.openSync(app.logPath, 'a');
  } catch {
    fd = 'ignore';
  }
  const child = spawn(cmd, args, {
    cwd,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: process.env,
  });
  if (typeof fd === 'number') fs.closeSync(fd);
  child.unref();
  app.pid = child.pid;
  app.state = 'running';
  app.since = Date.now();
  try {
    fs.writeFileSync(appPidPath(app), String(child.pid));
  } catch {
    /* ignore */
  }
  invalidate();
  return child;
}

// All dev builds share one user data dir (VSCODE_DEV pins the name to
// code-oss-dev) and its single-instance lock, so launching while another
// worktree's dev instance is open would silently hand this launch to it -
// the window that opens runs the *other* worktree's code. Match F5's
// fail-loudly behavior instead: detect a running instance and refuse to
// launch. A live instance holds a `<ver>-main.sock` singleton socket; a
// socket that accepts a connection means the instance is up (stale files
// left by crashes refuse the connection and are ignored).
function devUserDataDirs() {
  const home = os.homedir();
  const configRoot =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    path.join(configRoot, 'code-oss-dev'), // code.sh / positron-dev launches
    path.join(home, '.vscode-oss-dev'), // VS Code's F5 debug targets
  ];
}

function singletonSocketsIn(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith('-main.sock')).map((n) => path.join(dir, n));
}

function candidateSingletonSockets() {
  const out = devUserDataDirs().flatMap(singletonSocketsIn);
  // On Linux the socket lives in XDG_RUNTIME_DIR instead, named
  // vscode-<scope>-<ver>-main.sock where scope hashes the user data dir.
  if (process.platform !== 'darwin' && process.env.XDG_RUNTIME_DIR) {
    const scopes = devUserDataDirs().map((d) =>
      crypto.createHash('sha256').update(d).digest('hex').slice(0, 8)
    );
    out.push(
      ...singletonSocketsIn(process.env.XDG_RUNTIME_DIR).filter((p) =>
        scopes.some((s) => path.basename(p).startsWith(`vscode-${s}-`))
      )
    );
  }
  return out;
}

function probeSocket(sockPath) {
  return new Promise((resolve) => {
    const sock = net.connect(sockPath);
    const done = (alive) => {
      sock.destroy();
      resolve(alive);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(1000, () => done(false));
  });
}

async function runningDevInstance() {
  for (const p of candidateSingletonSockets()) {
    if (await probeSocket(p)) return p;
  }
  return null;
}

async function launchElectron(withAssistant) {
  const app = apps.electron;
  const codeSh = path.join(CHECKOUT, 'scripts', 'code.sh');

  const running = await runningDevInstance();
  if (running) {
    const ours = app.pid && pidAlive(app.pid);
    const kind = running.includes('.vscode-oss-dev')
      ? 'an F5 debug session'
      : ours
        ? `this checkout's dev instance (pid ${app.pid} - k kills it)`
        : 'another dev instance';
    app.ring.push(
      `[positron-dev] not launching: ${kind} is already running. ` +
        `Close it first - dev builds share one instance lock, and a second ` +
        `launch would open a window running the existing instance's code.`
    );
    setStatus('a Positron dev instance is already running - close it first');
    activeTab = app.key;
    invalidate();
    return;
  }

  beginAppLaunch(app);
  activeTab = app.key;

  if (!withAssistant) {
    appendLog(app, `[positron-dev] launching ${codeSh} ...\n`);
    spawnAppProcess(app, codeSh, [], CHECKOUT);
    setStatus('launching Electron');
    return;
  }

  const assistantDir = assistantDirFor(CHECKOUT);
  const extPath = path.join(assistantDir, 'packages', 'positron');
  appendLog(app, `[positron-dev] building assistant in ${assistantDir} ...\n`);
  setStatus('building assistant, then launching');
  let fd;
  try {
    fd = fs.openSync(app.logPath, 'a');
  } catch {
    fd = 'ignore';
  }
  const prep = spawn('npm', ['run', 'build:positron'], {
    cwd: assistantDir,
    stdio: ['ignore', fd, fd],
    env: process.env,
  });
  if (typeof fd === 'number') fs.closeSync(fd);
  prep.on('exit', (code) => {
    if (code !== 0) {
      appendLog(
        app,
        `\n[positron-dev] assistant build failed (exit ${code}) - not launching. ` +
          `Fix the build and press a again.\n`
      );
      app.state = 'exited';
      setStatus('assistant build failed - not launching');
      invalidate();
      return;
    }
    appendLog(app, `\n[positron-dev] assistant build succeeded; launching Positron ...\n`);
    spawnAppProcess(app, codeSh, [`--extensionDevelopmentPath=${extPath}`], CHECKOUT);
    setStatus('launching Electron + Assistant');
  });
  prep.on('error', (e) => {
    appendLog(app, `[positron-dev] assistant build failed: ${e.message}\n`);
    app.state = 'exited';
    invalidate();
  });
}

function launchWeb() {
  const app = apps.web;
  const codeServer = path.join(CHECKOUT, 'scripts', 'code-server.sh');
  beginAppLaunch(app);
  activeTab = app.key;
  appendLog(app, `[positron-dev] launching ${codeServer} ...\n`);
  spawnAppProcess(app, codeServer, [
    '--no-launch',
    '--connection-token',
    'dev-token',
    '--port',
    '8080',
  ], CHECKOUT);
  setStatus('starting web server on :8080');
}

function openBrowser() {
  const url = 'http://localhost:8080?tkn=dev-token';
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const c = spawn(opener, [url], { detached: true, stdio: 'ignore' });
    c.unref();
    setStatus(`opened ${url}`);
  } catch (e) {
    setStatus(`could not open browser: ${e.message}`);
  }
}

// On startup, re-adopt any app whose pidfile points at a live process.
function resumeApps() {
  for (const app of Object.values(apps)) {
    const pid = Number(readFileSafe(appPidPath(app)).trim());
    if (!pid || !pidAlive(pid)) continue;
    app.pid = pid;
    app.logPath = appLogPath(app);
    app.state = 'running';
    app.since = mtimeSafe(appPidPath(app)) || null; // pidfile mtime = launch time
    app.feeder = newAppFeeder(app);
    let size = 0;
    try {
      // Seed the ring with the tail of the existing log (last 128 KB).
      const st = fs.statSync(app.logPath);
      size = st.size;
      const start = Math.max(0, st.size - 131072);
      const fd = fs.openSync(app.logPath, 'r');
      const len = st.size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      fs.closeSync(fd);
      for (const line of buf.toString('utf8').split(/\r\n?|\n/)) {
        if (line.length) {
          const clean = stripAnsi(line);
          app.ring.push(clean);
          if (app.readyRe && app.readyRe.test(clean)) app.state = 'ready';
        }
      }
    } catch {
      /* no log yet */
    }
    app.ring.push(`[positron-dev] resumed (pid ${pid}); tailing ${app.logPath}`);
    startTail(app, size);
  }
}

// Kill a launched app (Electron / web server). They are spawned detached, so
// the recorded pid is a process-group leader; signal the whole group to take
// code.sh's children (Electron itself) down with it.
function killApp(app) {
  if (!app.pid || !pidAlive(app.pid)) {
    setStatus(`${app.label} is not running`);
    return;
  }
  const pid = app.pid;
  const signalTree = (sig) => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        /* already gone */
      }
    }
  };
  app.ring.push(`[positron-dev] killing ${app.label} (pid ${pid}) ...`);
  signalTree('SIGTERM');
  setStatus(`killing ${app.label}`);
  let ticks = 0;
  const poll = setInterval(() => {
    if (pidAlive(pid)) {
      ticks++;
      if (ticks === 10) signalTree('SIGKILL'); // ~3s of grace, then hard kill
      if (ticks > 30) clearInterval(poll); // stop watching; pidfile logic re-checks
      return;
    }
    clearInterval(poll);
    if (app.pid === pid) {
      app.pid = null;
      app.state = 'exited';
      app.ring.push(`[positron-dev] ${app.label} exited (killed)`);
      try {
        fs.unlinkSync(appPidPath(app));
      } catch {
        /* ignore */
      }
    }
    invalidate();
  }, 300);
  invalidate();
}

// ============================================================================
// S6b. Deps card - npm install freshness + one-key install
// ============================================================================
//
// npm stamps node_modules/.package-lock.json on every install, so a
// package-lock.json newer than that stamp (e.g. after a pull) means the tree
// is stale. A sibling assistant repo is checked the same way.

let deps = null;

function mtimeSafe(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function depsStateFor(dir) {
  if (!fs.existsSync(path.join(dir, 'node_modules'))) return 'missing';
  const lock = mtimeSafe(path.join(dir, 'package-lock.json'));
  const stamp = mtimeSafe(path.join(dir, 'node_modules', '.package-lock.json'));
  return lock > stamp ? 'stale' : 'ok';
}

function initDeps(checkout, assistantDirOverride) {
  const targets = [{ name: 'positron', dir: checkout, state: 'ok' }];
  const assistantDir = assistantDirOverride ?? siblingAssistantDir(checkout);
  if (assistantDir) targets.push({ name: 'assistant', dir: assistantDir, state: 'ok' });
  deps = {
    key: String(watchers.length + 3), // after Electron and Web
    label: 'Deps',
    state: 'ok',
    statusLine: '',
    ring: new Ring(),
    targets,
    child: null,
  };
  refreshDeps();
}

function refreshDeps() {
  if (!deps || deps.state === 'installing' || deps.state === 'failed') return;
  for (const t of deps.targets) t.state = depsStateFor(t.dir);
  const prev = deps.state;
  deps.state = deps.targets.some((t) => t.state === 'missing')
    ? 'missing'
    : deps.targets.some((t) => t.state === 'stale')
      ? 'stale'
      : 'ok';
  deps.statusLine = deps.targets.map((t) => `${t.name}: ${t.state}`).join('   ');
  if (deps.state !== prev) invalidate();
}

// `i` pressed. force = second press after the "all fresh" prompt.
function handleInstallKey(force) {
  if (deps.child) return setStatus('npm install already running');
  if (deps.state === 'failed') deps.state = 'ok'; // let refresh re-derive
  refreshDeps();
  if (deps.state === 'ok' && !force) {
    confirmInstall = true;
    activeTab = deps.key;
    return invalidate();
  }
  runInstall(force);
}

function runInstall(force) {
  // Installing under the wrong Node major builds native modules against the
  // wrong ABI and leaves a broken tree - refuse rather than half-work.
  const want = readFileSafe(path.join(CHECKOUT, '.nvmrc')).trim();
  if (want && want.split('.')[0] !== process.versions.node.split('.')[0]) {
    activeTab = deps.key;
    deps.ring.push(
      `[positron-dev] refusing npm install: node ${process.versions.node} running but .nvmrc wants ${want}.`
    );
    deps.ring.push('[positron-dev] switch node (nvm use) and relaunch positron-dev, then press i again.');
    setStatus('node version mismatch - install refused');
    return invalidate();
  }
  const todo = deps.targets.filter((t) => force || t.state !== 'ok');
  if (!todo.length) return setStatus('deps look up to date');
  deps.state = 'installing';
  activeTab = deps.key;
  setStatus('running npm install');
  const runNext = (i) => {
    if (i >= todo.length) {
      deps.child = null;
      deps.state = 'ok';
      refreshDeps();
      deps.ring.push('[positron-dev] npm install finished');
      setStatus('npm install finished');
      // Watchers that failed for missing deps can attach now.
      for (const w of watchers) {
        if (w.state !== 'no-deps') continue;
        if (w.manualStart && !daemonExists(w.cwd, w.args)) continue;
        w.state = 'no-daemon';
        attachWatcher(w);
      }
      return invalidate();
    }
    const t = todo[i];
    deps.ring.push(`[positron-dev] npm install in ${displayPath(t.dir)} ...`);
    const feeder = new LineFeeder((line) => {
      deps.ring.push(line);
      invalidate();
    });
    // Detached so a cancel (k) can signal the whole npm process group.
    const child = spawn('npm', ['install'], {
      cwd: t.dir,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    deps.child = child;
    child.stdout.on('data', (d) => feeder.push(d));
    child.stderr.on('data', (d) => feeder.push(d));
    child.on('exit', (code, signal) => {
      deps.child = null;
      if (code !== 0) {
        deps.state = 'failed';
        deps.ring.push(
          `[positron-dev] npm install in ${t.name} exited with ${signal || `code ${code}`}`
        );
        setStatus(`npm install failed in ${t.name}`);
        return invalidate();
      }
      runNext(i + 1);
    });
    child.on('error', (e) => {
      deps.child = null;
      deps.state = 'failed';
      deps.ring.push(`[positron-dev] npm install failed to start: ${e.message}`);
      invalidate();
    });
  };
  runNext(0);
  invalidate();
}

function cancelInstall() {
  const child = deps.child;
  if (!child) return setStatus('nothing to kill on Deps (i runs npm install)');
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  deps.state = 'failed'; // sticky until the next i re-derives freshness
  deps.ring.push('[positron-dev] npm install cancelled');
  setStatus('npm install cancelled');
}

// ============================================================================
// S7. Renderer
// ============================================================================

let activeTab = '1';
let statusMsg = '';
let statusUntil = 0;
let confirmKill = false;
let confirmInstall = false;
let frameTimer = null;
let frameCount = 0;
let HEADLESS = false; // status mode: no TUI, never render

function invalidate() {
  if (HEADLESS) return;
  if (frameTimer) return;
  frameTimer = setTimeout(() => {
    frameTimer = null;
    render();
  }, 33);
}

function setStatus(msg) {
  statusMsg = msg;
  statusUntil = Date.now() + 6000;
  invalidate();
}

function allTabs() {
  return [...watchers, apps.electron, apps.web, deps];
}

function tabByKey(key) {
  return allTabs().find((t) => t.key === key) || watchers[0];
}

let logExpanded = false; // false = card grid (default), true = full-height log

function spin() {
  return SPINNER[frameCount % SPINNER.length];
}

// ---- unified status helpers (watchers and apps share these) ----

const STATE_COLOR = {
  ok: C.green,
  ready: C.green,
  running: C.green,
  compiling: C.yellow,
  launching: C.yellow,
  attaching: C.cyan,
  errors: C.red,
  'no-deps': C.red,
  missing: C.red,
  failed: C.red,
  stale: C.yellow,
  installing: C.yellow,
  'no-daemon': C.gray,
  stopped: C.gray,
  idle: C.gray,
  exited: C.gray,
};

function stateColor(state) {
  return STATE_COLOR[state] || C.gray;
}

function isBusy(state) {
  return (
    state === 'compiling' || state === 'attaching' || state === 'launching' || state === 'installing'
  );
}

function glyphFor(tab) {
  const g = isBusy(tab.state) ? spin() : DOT;
  return stateColor(tab.state) + g + C.reset;
}

function stateText(tab) {
  if (tab.state === 'errors') return `${tab.errorCount} error${tab.errorCount === 1 ? '' : 's'}`;
  if (tab.state === 'running' && tab.pid) return `running (pid ${tab.pid})`;
  if (tab.state === 'ready' && tab.name === 'web') return 'ready on :8080';
  const map = {
    'no-deps': 'no deps',
    'no-daemon': 'off',
    attaching: 'attaching',
    compiling: 'compiling',
    ok: 'ok',
    running: 'running',
    stopped: 'stopped',
    idle: 'idle',
    launching: 'launching',
    ready: 'ready',
    exited: 'exited',
    missing: 'npm install needed',
    stale: 'stale (i installs)',
    installing: 'installing',
    failed: 'install failed',
  };
  return map[tab.state] || tab.state;
}

function agoText(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Freshness badge for a card: how old the verdict is (watchers) or how long
// the process has been up (apps). Empty when there's nothing meaningful.
function cardAge(tab) {
  if (tab.verdictAt && (tab.state === 'ok' || tab.state === 'errors')) {
    const a = agoText(tab.verdictAt);
    return a === 'now' ? 'just now' : `${a} ago`;
  }
  if (tab.since && (tab.state === 'running' || tab.state === 'ready')) {
    return `up ${agoText(tab.since).replace('now', '<10s')}`;
  }
  return '';
}

// Tint a log line by what it says: errors red, warnings yellow, clean
// verdicts green, tool chatter dim. Rings hold plain text; color is
// render-time only.
function paintLog(line) {
  if (/^\[(?:deemon|positron-dev)\]/.test(line)) return C.dim + line + C.reset;
  if (/(?:with|Found) 0 errors?\b/.test(line)) return C.green + line + C.reset;
  if (/\berrors?\b|\berror TS\d+/i.test(line)) return C.red + line + C.reset;
  if (/\bwarn(?:ing)?s?\b/i.test(line)) return C.yellow + line + C.reset;
  return line;
}

// Last meaningful line for a tab's card summary.
function cardSummary(tab) {
  if (tab.statusLine) return tab.statusLine;
  const lines = tab.ring.lines;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l || l.startsWith('[deemon]')) continue;
    return l;
  }
  if (tab.state === 'idle') return 'not launched';
  if (tab.state === 'no-daemon' || tab.state === 'stopped') return 'daemon not running';
  return '';
}

// Assemble pre-colored cells with a fixed visible gap, truncating to `cols`.
function assemble(cells, cols, gap) {
  const sep = ' '.repeat(gap);
  let out = '';
  let width = 0;
  for (let i = 0; i < cells.length; i++) {
    const add = i ? sep : '';
    const cellVis = visLen(cells[i].s);
    if (width + add.length + cellVis > cols) break;
    out += add + cells[i].s;
    width += add.length + cellVis;
  }
  return out;
}

function rule(cols) {
  return C.gray + RULE.repeat(cols) + C.reset;
}

// ---- header ----

function nodeBadge() {
  const want = readFileSafe(path.join(CHECKOUT, '.nvmrc')).trim();
  const have = process.versions.node;
  if (!want) return `${C.dim}node ${have}${C.reset}`;
  if (have === want) return `${C.green}node ${have}${C.reset}`;
  const sev = want.split('.')[0] !== have.split('.')[0] ? C.red : C.yellow;
  return `${sev}node ${have} (want ${want})${C.reset}`;
}

function renderHeader(cols) {
  const title = `${C.bold}positron-dev${C.reset}`;
  const titleVis = 12;
  const badge = nodeBadge();
  const badgeVis = visLen(badge);
  let p = displayPath(CHECKOUT);
  const maxP = cols - 1 - titleVis - 2 - badgeVis - 1;
  if (p.length > maxP) p = p.slice(0, Math.max(0, maxP));
  const leftVis = 1 + titleVis + 2 + p.length;
  const pad = Math.max(1, cols - leftVis - badgeVis);
  return ` ${title}  ${C.dim}${p}${C.reset}${' '.repeat(pad)}${badge}`;
}

// ---- card grid (default view) ----

function gridColumns(cols) {
  return cols >= 100 ? 3 : cols >= 64 ? 2 : 1;
}

function contentLine(content, cwid, bcol) {
  const padN = Math.max(0, cwid - visLen(content));
  return `${bcol}│${C.reset} ${content}${' '.repeat(padN)} ${bcol}│${C.reset}`;
}

// Render one tab as a 4-line boxed card of visible width W.
function card(tab, W, selected) {
  const inner = W - 2; // between the corner glyphs
  const cwid = W - 4; // text width inside "| ... |"
  const bcol = tab.state === 'errors' ? C.red : selected ? C.blue : C.gray;

  let titleTxt = ` ${tab.key} ${tab.label} `;
  if (titleTxt.length > inner - 1) titleTxt = titleTxt.slice(0, inner - 1);
  const titleCol = selected ? `${C.inverse}${C.bold}` : C.bold;
  const dashes = Math.max(0, inner - 1 - titleTxt.length);
  const top = `${bcol}╭─${C.reset}${titleCol}${titleTxt}${C.reset}${bcol}${RULE.repeat(dashes)}╮${C.reset}`;
  const bottom = `${bcol}╰${RULE.repeat(inner)}╯${C.reset}`;

  const age = cardAge(tab);
  let status = `${glyphFor(tab)} ${stateColor(tab.state)}${C.bold}${stateText(tab)}${C.reset}`;
  // Add the freshness badge only if it fits inside the card.
  if (age && visLen(status) + 3 + age.length <= cwid) {
    status += `${C.dim} · ${age}${C.reset}`;
  }
  const summary = `${C.dim}${clip(cardSummary(tab), cwid)}${C.reset}`;
  return [top, contentLine(status, cwid, bcol), contentLine(summary, cwid, bcol), bottom];
}

function renderGrid(tabs, cols) {
  const gap = 1;
  const ncols = gridColumns(cols);
  const W = Math.floor((cols - (ncols - 1) * gap) / ncols);
  const lines = [];
  for (let i = 0; i < tabs.length; i += ncols) {
    const group = tabs.slice(i, i + ncols).map((t) => card(t, W, t.key === activeTab));
    for (let ln = 0; ln < 4; ln++) {
      lines.push(group.map((c) => c[ln]).join(' '.repeat(gap)));
    }
  }
  return lines;
}

function detailDivider(tab, cols) {
  const label = ` ${tab.key} ${tab.label} logs `;
  const left = `${C.gray}${RULE.repeat(2)}${C.reset}${C.bold}${label}${C.reset}`;
  const used = 2 + label.length;
  return left + C.gray + RULE.repeat(Math.max(0, cols - used)) + C.reset;
}

// ---- compact tab strip (used in expanded-log view) ----

function renderTabStrip(cols) {
  const cells = allTabs().map((t) => {
    const active = t.key === activeTab;
    const key = (active ? C.inverse + C.bold : C.dim) + ` ${t.key} ` + C.reset;
    const label = (active ? C.bold : '') + t.label + C.reset;
    return { s: `${key} ${label} ${glyphFor(t)}` };
  });
  return assemble(cells, cols, 2);
}

// ---- footer + status ----

// Keys that make sense for the selected card; the launch/daemon keys still
// work globally, but the footer only advertises what applies right here.
function contextKeys() {
  const t = tabByKey(activeTab);
  if (watchers.includes(t)) {
    return [
      ['r', 'restart'],
      ['k', 'kill'],
      ['K', confirmKill ? 'KILL?' : 'kill all'],
      ['s', 'start all'],
    ];
  }
  if (t === apps.electron) {
    return [
      ['e', 'launch'],
      ['a', 'launch +asst'],
      ['k', 'kill'],
    ];
  }
  if (t === apps.web) {
    return [
      ['w', 'launch'],
      ['b', 'browser'],
      ['k', 'kill'],
    ];
  }
  if (t === deps) {
    return [
      ['i', 'install'],
      ['k', 'cancel'],
    ];
  }
  return [];
}

function renderFooter(cols) {
  const keys = [
    [`1-${allTabs().length}/arrows`, 'select'],
    ['enter', logExpanded ? 'grid' : 'logs'],
    ...contextKeys(),
    ['?', 'help'],
    ['q', 'quit'],
  ];
  const cells = keys.map(([k, label]) => ({
    s: `${C.bold}${C.blue}${k}${C.reset}${C.dim}:${label}${C.reset}`,
  }));
  return ' ' + assemble(cells, cols - 1, 2);
}

// ---- help overlay (?) ----

let helpVisible = false;

const HELP_KEYS = [
  ['1-N / arrows', 'select a card'],
  ['enter / l', 'expand / collapse the selected log'],
  ['e', 'launch the Electron dev build'],
  ['a', 'launch Electron + Assistant'],
  ['w', 'start the web server on :8080'],
  ['b', 'open the web UI in a browser'],
  ['r', 'restart the selected build daemon'],
  ['k', 'kill the selected card: daemon, app, or npm install'],
  ['K', 'kill ALL build daemons (press twice to confirm)'],
  ['i', 'npm install where Deps flags it (press twice to force)'],
  ['s', 'start / re-attach all daemons'],
  ['?', 'toggle this help'],
  ['q', 'quit - daemons and launched apps keep running'],
];

function renderHelp(cols, rows) {
  const out = [renderHeader(cols), '', ` ${C.bold}Keys${C.reset}`, ''];
  const keyW = Math.max(...HELP_KEYS.map(([k]) => k.length));
  for (const [k, desc] of HELP_KEYS) {
    out.push(`   ${C.bold}${C.blue}${k}${C.reset}${' '.repeat(keyW - k.length)}   ${desc}`);
  }
  out.push('', ` ${C.dim}press any key to close${C.reset}`);
  writeFrame(out, rows);
}

function renderStatus() {
  const now = Date.now();
  let msg = '';
  if (confirmKill) msg = `${C.yellow}Press K again to kill all daemons (any other key cancels)${C.reset}`;
  else if (confirmInstall)
    msg = `${C.yellow}Deps look up to date - press i again to npm install anyway (any other key cancels)${C.reset}`;
  else if (statusMsg && now < statusUntil) msg = `${C.dim}${statusMsg}${C.reset}`;
  return ' ' + msg;
}

// ---- frame assembly ----

let PREVIEW = null; // { cols, rows } when running `--preview` (plain stdout, no daemons)

function writeFrame(lines, rows) {
  const frame = lines.slice(0, rows);
  while (frame.length < rows) frame.push('');
  if (PREVIEW) {
    process.stdout.write(frame.map(stripAnsi).join('\n') + '\n');
    return;
  }
  process.stdout.write(HOME + frame.map((l) => l + EOL).join('\r\n'));
}

function render() {
  if (!PREVIEW && !process.stdout.isTTY) return;
  frameCount++;
  const cols = PREVIEW ? PREVIEW.cols : process.stdout.columns || 80;
  const rows = PREVIEW ? PREVIEW.rows : process.stdout.rows || 24;
  if (helpVisible) return renderHelp(cols, rows);
  const active = tabByKey(activeTab);
  const out = [];

  if (logExpanded) {
    out.push(renderHeader(cols), renderTabStrip(cols), rule(cols));
    const logRows = Math.max(1, rows - out.length - 2);
    const lines = active.ring.tail(logRows);
    for (let i = 0; i < logRows - lines.length; i++) out.push('');
    for (const l of lines) out.push(paintLog(clip(l, cols)));
    out.push(renderFooter(cols), renderStatus());
    return writeFrame(out, rows);
  }

  out.push(renderHeader(cols), '');
  out.push(...renderGrid(allTabs(), cols));
  out.push(''); // breathing room between the grid and the log panel
  out.push(detailDivider(active, cols));
  const logRows = Math.max(0, rows - out.length - 2); // reserve footer + status
  const lines = active.ring.tail(logRows);
  for (const l of lines) out.push(paintLog(clip(l, cols))); // newest at bottom, hugging the divider
  for (let i = lines.length; i < logRows; i++) out.push(''); // pad down to the footer
  out.push(renderFooter(cols), renderStatus());
  writeFrame(out, rows);
}

// ============================================================================
// S8. Input + main()
// ============================================================================

let spinTimer = null;

function anyBusy() {
  return (
    watchers.some((w) => w.state === 'compiling' || w.state === 'attaching') ||
    Object.values(apps).some((a) => a.state === 'launching')
  );
}

function tickSpinner() {
  // Keep the spinner animating while something is busy, without busy-looping.
  spinTimer = setInterval(() => {
    if (anyBusy()) invalidate();
  }, 120);
}

function restartActive() {
  const t = tabByKey(activeTab);
  if (watchers.includes(t)) {
    restartWatcher(t);
    setStatus(`restarting ${t.label}`);
  } else {
    setStatus(`r restarts a build daemon (tabs 1-${watchers.length})`);
  }
}

// Arrow keys move the selection over the card grid: left/right step through
// the tabs (wrapping), up/down jump a whole grid row. In the expanded-log
// view the tab strip is a single row, so up/down degrade to prev/next.
function moveSelection(dx, dy) {
  const tabs = allTabs();
  let idx = tabs.findIndex((t) => t.key === activeTab);
  if (idx < 0) idx = 0;
  let next = idx;
  if (dx) {
    next = (idx + dx + tabs.length) % tabs.length;
  } else if (dy) {
    const ncols = logExpanded ? 1 : gridColumns(process.stdout.columns || 80);
    next = idx + dy * ncols;
    if (next >= tabs.length) next = tabs.length - 1; // short last row: clamp
    if (next < 0) return; // already on the top row
  }
  if (next === idx) return;
  activeTab = tabs[next].key;
  invalidate();
}

// k = kill whatever the selected card is: one daemon, one app, or a running
// npm install. Kill-all lives on K (with confirm).
function killActive() {
  const t = tabByKey(activeTab);
  if (watchers.includes(t)) {
    killWatcher(t);
    setStatus(`killing ${t.label} daemon`);
  } else if (t === deps) {
    cancelInstall();
  } else {
    killApp(t);
  }
}

function onKey(str, key) {
  if (key && key.ctrl && key.name === 'c') return quit();

  // Help overlay swallows the next keypress to close itself (except quit).
  if (helpVisible) {
    helpVisible = false;
    if ((str || '').toLowerCase() === 'q') return quit();
    return invalidate();
  }
  if (str === '?') {
    helpVisible = true;
    confirmKill = false;
    confirmInstall = false;
    return invalidate();
  }

  // Pending confirms are one-shot: the very next key either completes or
  // cancels them.
  const wasKillPending = confirmKill;
  const wasInstallPending = confirmInstall;
  const wasConfirming = confirmKill || confirmInstall;
  confirmKill = false;
  confirmInstall = false;

  // K (uppercase) = kill ALL daemons, second press confirms.
  if (str === 'K') {
    if (wasKillPending) return killAll();
    confirmKill = true;
    return invalidate();
  }

  const k = (str || '').toLowerCase();
  if (k === 'i') return handleInstallKey(wasInstallPending);

  if (key && (key.name === 'return' || key.name === 'enter')) {
    logExpanded = !logExpanded;
    return invalidate();
  }
  if (key && key.name === 'left') return moveSelection(-1, 0);
  if (key && key.name === 'right') return moveSelection(1, 0);
  if (key && key.name === 'up') return moveSelection(0, -1);
  if (key && key.name === 'down') return moveSelection(0, 1);
  if (str >= '1' && str <= String(Math.min(9, allTabs().length))) {
    activeTab = str;
    return invalidate();
  }
  switch (k) {
    case 'l':
      logExpanded = !logExpanded;
      return invalidate();
    case 'q':
      return quit();
    case 'e':
      return launchElectron(false);
    case 'a':
      return launchElectron(true);
    case 'w':
      return launchWeb();
    case 'b':
      return openBrowser();
    case 'r':
      return restartActive();
    case 'k':
      return killActive();
    case 's':
      return startAll();
    default:
      if (wasConfirming) invalidate(); // repaint to drop the confirm prompt
      return;
  }
}

let quitting = false;
function quit() {
  if (quitting) return;
  quitting = true;
  for (const w of watchers) detachWatcher(w);
  for (const app of Object.values(apps)) stopTail(app);
  // Don't orphan a half-done npm install; it's idempotent to re-run.
  if (deps && deps.child) {
    try {
      process.kill(-deps.child.pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
  }
  // Give the detach writes a moment to flush, then restore the screen.
  setTimeout(() => {
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {
      /* ignore */
    }
    process.stdout.write(CUR_SHOW + ALT_OFF);
    process.exit(0);
  }, 300);
}

function setupInput() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('keypress', onKey);
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
}

// Resolve the checkout: an explicit path argument (absolute or relative to the
// cwd; may point anywhere inside the checkout), else walk up from the cwd.
function resolveCheckout(explicit) {
  const start = realpathSafe(path.resolve(explicit ?? '.'));
  const found = findCheckoutFromCwd(start);
  if (found) return realpathSafe(found);
  if (explicit) console.error(`${explicit} is not (inside) a Positron checkout.`);
  else console.error('Not inside a Positron checkout.');
  console.error('Run positron-dev from inside one, or pass it: positron-dev <path>');
  process.exit(1);
}

// `positron-dev --preview [cols] [rows]` - render mock frames to plain stdout
// and exit. Spawns nothing; for iterating on the layout.
function runPreview() {
  const cols = Number(process.argv[3]) || 110;
  const rows = Number(process.argv[4]) || 30;
  PREVIEW = { cols, rows };
  CHECKOUT = findCheckoutFromCwd(realpathSafe(process.cwd())) || process.cwd();
  // Force the assistant card so the preview always shows the full layout.
  const previewAssistant = path.join(path.dirname(CHECKOUT), 'assistant');
  buildWatchers(CHECKOUT, previewAssistant);
  initApps(CHECKOUT);
  initDeps(CHECKOUT, previewAssistant);
  deps.state = 'stale';
  deps.statusLine = 'positron: stale   assistant: ok';
  deps.ring.push('[positron-dev] package-lock.json is newer than node_modules - press i to npm install');
  const [t, c, e, cp, asst] = watchers;
  t.state = 'ok';
  t.statusLine = 'Finished transpilation with 0 errors after 3 ms';
  t.verdictAt = Date.now() - 8000;
  c.state = 'compiling';
  c.statusLine = 'Starting compilation...';
  e.state = 'errors';
  e.errorCount = 2;
  e.verdictAt = Date.now() - 135000;
  e.statusLine = 'Finished compilation with 2 errors';
  e.ring.push('src/vs/workbench/foo.ts(42,7): error TS2322: Type mismatch.');
  cp.state = 'ok';
  cp.statusLine = '[watch] build finished';
  asst.state = 'compiling';
  asst.statusLine = '[tsc] File change detected. Starting incremental compilation...';
  apps.web.state = 'ready';
  apps.web.pid = 4242;
  apps.web.since = Date.now() - 47 * 60000;
  apps.web.ring.push('Web UI available at http://localhost:8080?tkn=dev-token');
  activeTab = '3';
  for (const w of watchers) w.ring.push(w.statusLine);
  console.log('=== grid view (default) ===');
  render();
  logExpanded = true;
  console.log('\n=== expanded log view (Enter / l) ===');
  render();
  logExpanded = false;
  helpVisible = true;
  console.log('\n=== help overlay (?) ===');
  render();
}

// ============================================================================
// S9. Status mode - `positron-dev status [--json] [checkout]`
// ============================================================================
//
// Non-interactive snapshot for agents and scripts. Probes each build daemon by
// attaching a read-only deemon client (`--attach` never spawns a daemon),
// parses the replayed output through the same state machine the TUI uses,
// then detaches. Nothing is started, stopped, or left behind. Exit code is 0
// whenever the probe itself succeeds, even if builds have errors.

// Attach read-only, let the replay drive the state machine, detach on the
// attached marker (deemon replays the buffer *before* printing it, so by then
// the state is current).
function probeWatcher(w, timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!hasDeemon()) {
      w.state = 'no-deps';
      return resolve();
    }
    if (!daemonExists(w.cwd, w.args)) {
      w.state = 'no-daemon';
      return resolve();
    }
    w.state = 'attaching';
    let done = false;
    let child = null;
    const finish = (note) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (note) w.probeNote = note;
      w.detaching = true; // daemon keeps running; our client exit is not 'stopped'
      try {
        child && child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      resolve();
    };
    const timer = setTimeout(() => finish('probe timed out'), timeoutMs);
    w.feeder = new LineFeeder((line) => {
      ingestWatcherLine(w, line);
      if (/\[deemon\] No daemon running/.test(line)) {
        w.state = 'no-daemon'; // stale socket
        finish();
      } else if (/\[deemon\] (Spawned|Attached to running)/.test(line)) {
        // Replay is fully parsed; a short grace catches in-flight output.
        setTimeout(() => finish(), 200);
      }
    });
    child = spawn(process.execPath, [DEEMON_BIN, '--attach', 'npm', ...w.args], {
      cwd: w.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    child.stdout.on('data', (d) => w.feeder.push(d));
    child.stderr.on('data', (d) => w.feeder.push(d));
    // Client exiting before the marker means the daemon is gone (the state
    // machine already handled 'Build daemon exited' / stale-socket lines).
    child.on('exit', () => {
      if (w.state === 'attaching') w.state = 'no-daemon';
      finish();
    });
    child.on('error', (err) => {
      w.ring.push(`[positron-dev] probe failed: ${err.message}`);
      w.state = 'no-daemon';
      finish();
    });
  });
}

// Error lines from the last compile cycle (from the last `begins` match on).
function watcherErrors(w) {
  const lines = w.ring.lines;
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (w.begins && w.begins.test(lines[i])) {
      start = i;
      break;
    }
  }
  const out = [];
  for (let i = start; i < lines.length && out.length < 50; i++) {
    const l = lines[i];
    if (w.ends && w.ends.test(l)) continue; // the verdict line is statusLine already
    if (/\berror\b/i.test(l)) out.push(l.trim());
  }
  return out;
}

// App state from the pidfile + log, without tailing.
function probeApp(app) {
  app.logPath = appLogPath(app);
  const pid = Number(readFileSafe(appPidPath(app)).trim()) || null;
  const alive = pid ? pidAlive(pid) : false;
  app.pid = alive ? pid : null;
  app.state = alive ? 'running' : pid ? 'exited' : 'idle';
  if (alive && app.readyRe) {
    try {
      const st = fs.statSync(app.logPath);
      const start = Math.max(0, st.size - 131072);
      const fd = fs.openSync(app.logPath, 'r');
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      if (app.readyRe.test(stripAnsi(buf.toString('utf8')))) app.state = 'ready';
    } catch {
      /* no log yet */
    }
  }
}

function statusReport() {
  const want = readFileSafe(path.join(CHECKOUT, '.nvmrc')).trim() || null;
  return {
    checkout: CHECKOUT,
    node: { running: process.versions.node, want },
    deps: deps.targets.map((t) => ({ name: t.name, dir: t.dir, state: depsStateFor(t.dir) })),
    daemons: watchers.map((w) => ({
      label: w.label,
      script: w.args[w.args.length - 1],
      cwd: w.cwd,
      state: w.state,
      errorCount: w.errorCount,
      statusLine: w.statusLine || null,
      ...(w.probeNote ? { note: w.probeNote } : {}),
      errors: w.state === 'errors' ? watcherErrors(w) : [],
      tail: w.ring.tail(15),
    })),
    apps: Object.values(apps).map((app) => ({
      label: app.label,
      state: app.state,
      pid: app.pid,
      log: app.logPath,
      ...(app.name === 'web' && (app.state === 'running' || app.state === 'ready')
        ? { url: 'http://localhost:8080?tkn=dev-token' }
        : {}),
    })),
  };
}

function printStatusText(report) {
  const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
  console.log(`checkout  ${displayPath(report.checkout)}`);
  const nodeNote =
    report.node.want && report.node.want !== report.node.running
      ? ` (want ${report.node.want})`
      : '';
  console.log(`node      ${report.node.running}${nodeNote}`);
  console.log(
    `deps      ${report.deps.map((d) => `${d.name}: ${d.state}`).join('   ')}`
  );
  console.log('\ndaemons');
  for (const w of watchers) {
    console.log(`  ${pad(w.label, 10)} ${pad(stateText(w), 11)} ${w.statusLine || ''}`.trimEnd());
    if (w.state === 'errors') {
      for (const e of watcherErrors(w)) console.log(`    ${e}`);
    }
  }
  console.log('\napps');
  for (const r of report.apps) {
    const pid = r.pid ? ` (pid ${r.pid})` : '';
    const where = r.url || displayPath(r.log);
    console.log(`  ${pad(r.label, 10)} ${pad(r.state + pid, 19)} ${where}`.trimEnd());
  }
}

async function runStatus(argv) {
  HEADLESS = true;
  const json = argv.includes('--json');
  const rest = argv.filter((a) => a !== '--json' && a !== '--status' && a !== 'status');
  CHECKOUT = resolveCheckout(rest[0]);
  buildWatchers(CHECKOUT);
  initApps(CHECKOUT);
  initDeps(CHECKOUT);
  await Promise.all(watchers.map((w) => probeWatcher(w)));
  for (const app of Object.values(apps)) probeApp(app);
  const report = statusReport();
  if (json) console.log(JSON.stringify(report, null, 2));
  else printStatusText(report);
  process.exit(0);
}

async function main() {
  if (process.argv.includes('--preview')) return runPreview();
  const argv = process.argv.slice(2);
  if (argv[0] === 'status' || argv.includes('--status')) return runStatus(argv);
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('positron-dev needs an interactive terminal (TTY).');
    process.exit(1);
  }
  CHECKOUT = resolveCheckout(argv.find((a) => !a.startsWith('-')));
  buildWatchers(CHECKOUT);
  initApps(CHECKOUT);
  initDeps(CHECKOUT);
  setInterval(refreshDeps, 5000);
  setInterval(invalidate, 10000); // keep the "N ago" badges fresh

  process.stdout.write(ALT_ON + CUR_HIDE + CLEAR);
  setupInput();
  process.stdout.on('resize', () => {
    process.stdout.write(CLEAR);
    render();
  });

  resumeApps();
  for (const w of watchers) {
    // manualStart cards would spawn a real watch on attach; only auto-attach
    // when their daemon is already up.
    if (w.manualStart && !daemonExists(w.cwd, w.args)) {
      w.ring.push(`[positron-dev] ${w.label} watch is off - press s (or select it and press r) to start it.`);
      continue;
    }
    attachWatcher(w);
  }
  tickSpinner();
  render();
}

main().catch((err) => {
  try {
    process.stdout.write(CUR_SHOW + ALT_OFF);
  } catch {
    /* ignore */
  }
  console.error(err);
  process.exit(1);
});
