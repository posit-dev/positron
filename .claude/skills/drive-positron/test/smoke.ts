/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// drive-positron's smoke test: launches one Positron on a copy of fixture/,
// runs every helper once through its .sh, as an agent would, and checks the
// JSON. From the repo root (needs a built checkout, R, and the positron-python
// venv; about 8 minutes, --quick about 2):
//
//   node .claude/skills/drive-positron/test/smoke.ts [--quick] [--until NAME [--from-start]] [--results FILE] [--keep] [-- APP ARGS...]
//   node .claude/skills/drive-positron/test/smoke.ts --list
//
// --quick runs only the cases marked quick: one happy path per helper, and
// the cases they stand on. --keep leaves the instance running at the end and
// prints how to stop it.
// Each `// ----` section is a group (`groups` below). Its cases lean on the
// state the earlier sections built, so a group run starts with a short setup
// that builds it. --until NAME runs NAME's group: the setup, then the group's
// cases through NAME. --from-start runs every case through NAME instead, for a
// failure that needs an earlier section's state.
// The full run skips the setups.
// --list prints every case's name and group as JSON, and launches nothing.
// --results FILE writes every case's status, command and problem as JSON
// (SmokeResults in smoke-lib.ts), for heal/.
// Arguments after `--` go to the app through launch.sh (CI passes
// --no-sandbox and software-GL flags there).
// Prints one line per case (PASS, FAIL, or KNOWN for a failure listed in a
// case's `known`) and exits 1 on any FAIL. The instance is always stopped.

import { spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { launchFixture, stopFixture, type App } from './fixture-app.ts';
import { firstRow, groupIds, nameWords, flagValue, selectCases, SMOKE_ROOT, SMOKE_SESSION, threwResult, type Group, type SmokeResults } from './smoke-lib.ts';

const test = dirname(new URL(import.meta.url).pathname);
const scripts = resolve(test, '../scripts');
const repo = resolve(test, '../../../..');
const SESSION = SMOKE_SESSION;
const root = SMOKE_ROOT;
const ws = join(root, 'ws');
const dash = process.argv.indexOf('--');
const own = process.argv.slice(0, dash < 0 ? undefined : dash);
const keep = own.includes('--keep');
const quickOnly = own.includes('--quick');
const flag = (name: string) => {
	const v = flagValue(own, name);
	if (v instanceof Error) { console.log(v.message); process.exit(2); }
	return v;
};
const until = flag('--until');
const fromStart = own.includes('--from-start');
const resultsFile = flag('--results');
const appArgs = dash < 0 ? [] : process.argv.slice(dash + 1);

type Json = { ok?: boolean; error?: string; [key: string]: any };
interface Out { code: number; json: Json | null; text: string; stderr: string }
interface Case {
	name: string;
	/** The .sh and its arguments, without --session; a function to use what earlier cases found. */
	run: string[] | (() => string[]);
	stdin?: string;
	/** A failure case: it must exit non-zero with ok:false and an error (or a message on stderr). */
	fail?: boolean;
	/** Returns what is wrong with a result (a failure case's too), or nothing. */
	check?: (o: Out) => string | undefined | false;
	/** Milliseconds to wait first, for something the previous case started. */
	wait?: number;
	/** Tries again, up to this many times 3 s apart, while the failure matches retryOn (something still on its way). */
	retry?: number;
	retryOn?: RegExp;
	/** A failure we know about and have not fixed: shown as KNOWN with this reason, not FAIL. */
	known?: string;
	/** In the --quick run: a helper's one happy path, or a case one of those stands on. */
	quick?: boolean;
}

const found: Record<string, string> = {};
/** A string as it is, a list of strings one per line, anything else as JSON. */
const flat = (what: unknown) => typeof what === 'string' ? what : Array.isArray(what) && what.every(x => typeof x === 'string') ? what.join('\n') : JSON.stringify(what ?? '');
const includes = (what: unknown, needle: string) => flat(what).includes(needle) ? undefined : `expected ${JSON.stringify(needle)} in ${JSON.stringify(flat(what).slice(0, 300))}`;
/** The run's action log, where every action and reading leaves a line. */
const logged = (needle: string) => { const f = join(root, 'actions.log'); return includes(existsSync(f) ? readFileSync(f, 'utf8').split('\n').slice(-20) : '', needle); };
const keys = (j: Json | null, ...ks: string[]) => { const miss = ks.filter(k => !(j && k in j)); return miss.length ? `missing keys: ${miss.join(', ')}` : undefined; };

const cases: Case[] = [
	// ---- Palette, sessions, consoles
	{ name: 'palette-run dry run', quick: true, run: ['palette-run.sh', '--dry-run', 'Interpreter: Start New Console Session'], check: o => o.json?.chosen !== 'Interpreter: Start New Console Session' && 'wrong row chosen' },
	{ name: 'palette-run unknown command', run: ['palette-run.sh', 'Smoke: No Such Command'], fail: true },
	// One session (the workspace's Python) and no console tabs: --name must still match it.
	{ name: 'console-read the only session', quick: true, run: ['console-read.sh', '--prompt'], check: o => (!/\(python-[0-9a-f]+\)/.test(o.stderr) && `no python session id in ${o.stderr}`) || void (found.first = o.stderr.match(/\(python-([0-9a-f]+)\)/)![1]) },
	{ name: 'console-run only session, wrong --name', run: ['console-run.sh', '--language', 'python', '--name', 'no-such-session', 'x'], fail: true },
	{ name: 'console-run only session, bare id --name', quick: true, run: () => ['console-run.sh', '--language', 'python', '--name', found.first, '--capture', 'print("only", 6 * 7)'], check: o => includes(o.json!.output, 'only 42') },
	// The workspace's .R files may have started R already: either way one R session, with its id. --name is the picker's first R, since an image can have several.
	{ name: 'start-session r', quick: true, run: () => ['start-session.sh', '--language', 'r', '--name', found.rName], check: o => keys(o.json, 'started', 'sessionId', 'session') || (!/^r-/.test(o.json!.sessionId) && 'sessionId is not r-*') || void (found.r = o.json!.sessionId) },
	{ name: 'start-session python, one open already', run: () => ['start-session.sh', '--language', 'python', '--name', found.pyName], check: o => (o.json!.started !== false && 'started another') || (o.json!.sessionId !== `python-${found.first}` && `sessionId ${o.json!.sessionId}`) },
	{ name: 'start-session python --new', run: () => ['start-session.sh', '--language', 'python', '--name', found.pyName, '--new'], check: o => keys(o.json, 'runtime', 'sessionId') || (o.json!.started !== true && 'not started') || (!/^python-/.test(o.json!.sessionId) && 'sessionId is not python-*') || (o.json!.sessionId === `python-${found.first}` && 'the old session') || void (found.py = o.json!.sessionId) },
	{ name: 'panel sessions', run: ['panel.sh', 'sessions'], check: o => (o.json!.sessions?.filter((x: Json) => x.language === 'python').length !== 2 && `python sessions: ${JSON.stringify(o.json!.sessions)}`) || (!o.json!.sessions?.some((x: Json) => x.id === found.r && x.language === 'r') && 'no r session') || (o.json!.sessions?.filter((x: Json) => x.active).length !== 1 && 'not one active') },
	{ name: 'start-session bad language', run: ['start-session.sh', '--language', 'julia'], fail: true },
	// Switching the active console without running code: by language, name or id, never two.
	{ name: 'panel sessions empty --session=', run: ['panel.sh', 'sessions', '--session='], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json!.error, '--session needs the session name') },
	{ name: 'panel sessions --session with no value', run: ['panel.sh', 'sessions', '--session'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json!.error, '--session needs the session name') },
	{ name: 'panel console python (two match)', run: ['panel.sh', 'console', 'python'], fail: true, check: o => includes(o.json!.error, '2 consoles match') || logged('panel.sh -s=net1: FAILED console python: 2 consoles match') },
	{ name: 'panel console r', quick: true, run: ['panel.sh', 'console', 'r'], check: o => (o.json!.id !== found.r && `id ${o.json!.id}`) || (!o.json!.already && !o.json!.was && 'neither already nor was') },
	{ name: 'panel console by bare id', run: () => ['panel.sh', 'console', found.first], check: o => (o.json!.id !== `python-${found.first}` && `id ${o.json!.id}`) || logged(`panel.sh -s=net1: console ${found.first} -> active`) },
	{ name: 'console-run r --capture', run: ['console-run.sh', '--language', 'r', '--capture', 'cat("smoke", 6 * 7, "\\n")'], check: o => keys(o.json, 'sessionId', 'switched', 'busy', 'echoed', 'output') || includes(o.json!.output, 'smoke 42') },
	{ name: 'console-run python --capture (stdin)', run: () => ['console-run.sh', '--language', 'python', '--name', found.py, '--capture'], stdin: 'print("smoke", 6 * 7)\n', check: o => o.json!.sessionId !== found.py ? 'ran in another session' : includes(o.json!.output, 'smoke 42') },
	{ name: 'console-read r --tail', run: ['console-read.sh', '--language', 'r', '--tail', '5'], check: o => includes(o.text, 'smoke 42') },
	// --after prefers the command's own echo over a later command that holds the same text.
	{ name: 'console-run r a longer command', run: ['console-run.sh', '--language', 'r', '--capture', 'cat("smoke", 6 * 7, "\\n"); cat("later\\n")'], check: o => includes(o.json!.output, 'later') },
	{ name: 'console-read r --after the echo', run: ['console-read.sh', '--language', 'r', '--after', 'cat("smoke", 6 * 7, "\\n")', '--tail', '0'], check: o => includes(o.stderr, 'exactly the text') || includes(o.text.split('\n')[0], 'smoke 42') },
	{ name: 'console-read r --after no match', run: ['console-read.sh', '--language', 'r', '--after', 'smoke-no-such-text'], fail: true },
	// An empty value is a usage error, not the flag left out (which reads the active console).
	{ name: 'console-read empty --after', run: ['console-read.sh', '--after', ''], fail: true, check: o => includes(o.json!.error, '--after needs a value') },
	// A Python error's traceback is collapsed: console-read says so, and --expand shows its frames.
	{ name: 'console-run python error', run: () => ['console-run.sh', '--language', 'python', '--name', found.py, '--capture', 'def smoke_boom():\n    raise ValueError("smoke-boom")\n\nsmoke_boom()'], check: o => includes(o.json!.output, 'smoke-boom') },
	{ name: 'console-read traceback collapsed', run: () => ['console-read.sh', '--name', found.py, '--tail', '3'], check: o => includes(o.stderr, '1 traceback is collapsed') },
	{ name: 'console-read --expand', run: () => ['console-read.sh', '--name', found.py, '--expand', '--tail', '6'], check: o => includes(o.stderr, 'expanded 1 traceback') || includes(o.text, 'raise ValueError("smoke-boom")') },
	// Blank rows read as drawn: innerText doubled them at every block's edge.
	{ name: 'console-run python blank rows', run: () => ['console-run.sh', '--language', 'python', '--name', found.py, '--capture', 'print("blank-a\\n\\n\\nblank-b")'], check: o => o.json!.output !== 'blank-a\n\n\nblank-b' && `output ${JSON.stringify(o.json!.output)}` },
	{ name: 'console-read blank rows', run: () => ['console-read.sh', '--name', found.py, '--tail', '5'], check: o => includes(o.text, 'blank-a\n\n\nblank-b\n') },
	// A state on screen for a moment: watch samples in the page while another call acts.
	{ name: 'ui watch Console while R prints', run: () => { background(['console-run.sh', '--language', 'r', 'Sys.sleep(1); cat("smoke-watch-seen\\n")']); return ['ui.sh', 'watch', 'Console', '--for', '4', '--every', '50']; }, check: o => (!(o.json!.changes > 0) && 'no change seen') || includes(o.json!.states, '+ smoke-watch-seen') || logged('ui.sh -s=net1: read watch Console for 4 s:') },
	{ name: 'ui watch missing view', run: ['ui.sh', 'watch', 'No Such View', '--for', '1'], fail: true },
	{ name: 'ui watch --for too long', run: ['ui.sh', 'watch', 'Console', '--for', '999'], fail: true },
	{ name: 'ui watch --for not a number', run: ['ui.sh', 'watch', 'Console', '--for', 'abc'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json!.error, '--for must be a positive number of seconds') },
	{ name: 'ui click --wait negative', run: ['ui.sh', 'click', 'tab', 'Console', '--wait=-5'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json!.error, '--wait must be a number of seconds, 0 or more') },
	// A restart of a busy session asks first, in a toast: palette-run reports it.
	{ name: 'console-run python sleeps (busy)', run: () => ['console-run.sh', '--language', 'python', '--name', found.py, 'import time; time.sleep(6)'] },
	{ name: 'palette-run restart while busy (toast)', run: ['palette-run.sh', 'Interpreter: Restart Active Interpreter Session'], check: o => includes(o.json!.notification, 'The runtime is busy') || logged('-> toast Warning: The runtime is busy') },
	{ name: 'notifications click No (keep it running)', run: ['notifications.sh', '--click', 'No', '--match', 'runtime is busy'], check: o => o.json!.clicked !== 'No' && `clicked ${o.json!.clicked}` },
	{ name: 'shot the active console', run: ['shot.sh', '--view', 'active console', 'smoke-console.png'], check: o => !existsSync(o.text.trim()) && `no file ${o.text.trim()}` || logged('screenshot smoke-console.png of the active console') },
	{ name: 'shot --view missing view', run: ['shot.sh', '--view', 'No Such View', 'smoke-none-view.png'], fail: true },

	// ---- Editor and breakpoints
	{ name: 'open-file analysis.R', quick: true, run: ['open-file.sh', 'analysis.R'], check: o => o.json!.activeTab !== 'analysis.R' && `active tab ${o.json!.activeTab}` },
	{ name: 'open-file missing file', run: ['open-file.sh', 'missing.R'], fail: true },
	{ name: 'editor goto 4', quick: true, run: ['editor.sh', 'goto', '4'], check: o => ((o.json!.line !== 4 || o.json!.tab !== 'analysis.R') && `at ${o.json!.tab}:${o.json!.line}`) || logged('go to line 4 in analysis.R -> cursor 4:1') },
	{ name: 'editor cursor', run: ['editor.sh', 'cursor'], check: o => keys(o.json, 'tab', 'line', 'column') || (o.json!.line !== 4 && `line ${o.json!.line}`) || logged('editor.sh -s=net1: read analysis.R 4:1') },
	// A failure leaves its line in the action log, the evidence for a negative check.
	{ name: 'editor goto past the end', run: ['editor.sh', 'goto', '999'], fail: true, check: () => logged('editor.sh -s=net1: FAILED goto 999: ') },
	// Go to Line puts a column past the line's end at its end: that is a failure, and says how long the line is.
	{ name: 'editor goto past the line end', run: ['editor.sh', 'goto', '2:80'], fail: true, check: o => includes(o.json!.error, 'has only 35 characters') },
	{ name: 'editor type --at', run: ['editor.sh', 'type', '--at', '1:1', '# smoke-at '], check: o => (o.json!.actedAt !== '1:1' && `acted at ${o.json!.actedAt}`) || includes(o.json!.text, '# smoke-at # drive-positron') },
	{ name: 'editor key reports where', run: ['editor.sh', 'key', 'End'], check: o => (o.json!.actedAt !== '1:12' && `acted at ${o.json!.actedAt}`) },
	// A key with nowhere to go is a no-op, said so; one that should select and selects nothing fails.
	{ name: 'editor key End at the line end', run: ['editor.sh', 'key', 'End'], check: o => (o.json!.changed !== false && `changed ${o.json!.changed}`) || includes(o.json!.note, 'already where it moves to') },
	{ name: 'editor key Shift+End selects nothing', run: ['editor.sh', 'key', 'Shift+End'], fail: true, check: o => includes(o.json!.error, 'selected nothing') },
	{ name: 'editor insert 2', run: ['editor.sh', 'insert', '2', 'smoke_x <- 1'], check: o => (o.json!.at !== '2-2' && `at ${o.json!.at}`) || (o.json!.inserted !== 'smoke_x <- 1' && `inserted ${JSON.stringify(o.json!.inserted)}`) },
	// A trailing line break is not doubled: still one line, and the old line 3 right under it.
	{ name: 'editor insert with a trailing newline', run: ['editor.sh', 'insert', '3', 'smoke_y <- 2\n'], check: o => o.json!.at !== '3-3' && `at ${o.json!.at}` },
	{ name: 'editor read the inserted lines', run: ['editor.sh', 'read', '1:4'], check: o => (o.json!.lines?.['2'] !== 'smoke_x <- 1' || o.json!.lines?.['3'] !== 'smoke_y <- 2' || !String(o.json!.lines?.['4']).startsWith('values <-')) && `lines ${JSON.stringify(o.json!.lines)}` },
	{ name: 'editor insert without text', run: ['editor.sh', 'insert', '2'], fail: true },
	{ name: 'palette-run Revert File', run: ['palette-run.sh', 'File: Revert File'] },
	// Language features in R, from Ark: completions, the hover, Go to Definition.
	{ name: 'editor suggest R', run: ['editor.sh', 'suggest', '--at', '7:13'], retry: 3, retryOn: /no completion list|message/, check: o => includes(o.json!.rows, 'sum, {base}, Function') || (o.json!.closed !== true && 'the list is still open') || logged('editor.sh -s=net1: suggest at analysis.R 7:13 ->') },
	{ name: 'editor hover R', run: ['editor.sh', 'hover', '--at', '7:11'], check: o => includes(o.json!.hover, 'Sum of Vector Elements') || (o.json!.closed !== true && 'the hover is still open') },
	{ name: 'editor definition R', run: ['editor.sh', 'definition', '--at', '7:16'], check: o => (o.json!.line !== 3 && `landed at ${o.json!.tab} ${o.json!.line}`) || includes(o.json!.text, 'double_it <- function') },
	{ name: 'editor definition R, none', run: ['editor.sh', 'definition', '--at', '2:14'], check: o => (o.json!.found !== false && 'found one') || includes(o.json!.message, "No definition found for '3'") },
	{ name: 'editor hover --timeout not a number', run: ['editor.sh', 'hover', '--at', '7:11', '--timeout', 'abc'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json!.error, '--timeout must be a positive number of seconds, not "abc"') },
	{ name: 'editor hover R --timeout 5.', run: ['editor.sh', 'hover', '--at', '7:11', '--timeout', '5.'], check: o => includes(o.json!.hover, 'Sum of Vector Elements') },
	{ name: 'debug break analysis.R 4', quick: true, run: ['debug.sh', 'break', 'analysis.R', '4'], check: o => includes(o.json!.breakpoints, 'analysis.R 4') },
	{ name: 'debug state (breakpoint listed)', run: ['debug.sh', 'state'], check: o => includes(o.json!.trees?.Breakpoints, 'analysis.R 4') },
	// A line breakpoint by the label the view shows; the click renames its row.
	{ name: 'debug filter analysis.R 4 off', run: ['debug.sh', 'filter', 'analysis.R 4', 'off'], check: o => (o.json!.checked !== false && 'still checked') || includes(o.json!.renamed, 'Disabled Breakpoint') },
	{ name: 'debug filter analysis.R 4 on', run: ['debug.sh', 'filter', 'analysis.R 4', 'on'], check: o => (o.json!.checked !== true && 'not checked') || logged('check "analysis.R 4" "on" in Breakpoints') },
	{ name: 'debug filter missing row', run: ['debug.sh', 'filter', 'analysis.R 99', 'on'], fail: true },
	{ name: 'debug logpoint beside it', run: ['debug.sh', 'break', 'analysis.R', '4', '--log', 'smoke {1}'], check: o => includes(o.json!.row, 'Logpoint') || includes(o.json!.note, 'already had') },
	// Toggling the line removes both.
	{ name: 'debug break toggles it off', run: ['debug.sh', 'break', 'analysis.R', '4'], check: o => (o.json!.removed !== 'analysis.R:4' && `removed ${o.json!.removed}`) || (!includes(o.json!.breakpoints, 'analysis.R 4') && 'breakpoint still listed') },

	// ---- Debugging R: pause, read, step, continue
	{ name: 'debug wait running, not debugging', run: ['debug.sh', 'wait', 'running', '--timeout', '5'], check: o => o.json!.paused !== false && 'paused' },
	{ name: 'console-run r debugonce', run: ['console-run.sh', '--language', 'r', 'smoke_f <- function(x) { y <- x + 1; y * 2 }; debugonce(smoke_f); smoke_f(20)'] },
	{ name: 'console-read prompt in browser', wait: 2000, run: ['console-read.sh', '--language', 'r', '--prompt'], check: o => o.text.trim() !== 'Browse[1]>' && `prompt is "${o.text.trim()}"` },
	{ name: 'debug wait paused', run: ['debug.sh', 'wait', 'paused', '--timeout', '20'], check: o => includes(o.json!.frame, 'smoke_f') },
	{ name: 'debug state (paused)', run: ['debug.sh', 'state'], check: o => includes(o.json!.trees?.['Call Stack'], 'smoke_f') || includes(o.json!.trees?.['Debug Variables'], 'x = 20') || includes(o.json!.topFrame, 'smoke_f') || keys(o.json, 'selectedFrame') || logged('debug.sh -s=net1: read state: paused at smoke_f') },
	{ name: 'debug step over', run: ['debug.sh', 'step', 'over'], check: o => includes(o.json!.before, 'smoke_f') || (o.json!.before === o.json!.after && 'the Call Stack read the same after') },
	{ name: 'debug step continue', run: ['debug.sh', 'step', 'continue'], check: o => includes(o.json!.before, 'smoke_f') || logged('step continue -> Call Stack before: row "Stack Frame smoke_f') },
	{ name: 'debug wait paused, not debugging', run: ['debug.sh', 'wait', 'paused', '--timeout', '1'], fail: true, check: o => includes(o.json!.error, 'not paused after 1 s') || logged('debug.sh -s=net1: FAILED wait paused: not paused after 1 s') },
	{ name: 'debug --timeout with no value answers JSON on stdout', run: ['debug.sh', 'wait', 'paused', '--timeout'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json?.error, '--timeout needs a value') },
	// Continue from one pause to the next: step reports the view, and claims nothing about it.
	{ name: 'console-run r two browser() pauses', run: ['console-run.sh', '--language', 'r', 'smoke_g <- function(x) { browser(); y <- x + 1; browser(); y * 2 }; smoke_g(20)'] },
	{ name: 'debug wait paused (first browser())', run: ['debug.sh', 'wait', 'paused', '--timeout', '20'], check: o => includes(o.json!.frame, 'smoke_g') },
	{ name: 'debug step continue to the next pause', run: ['debug.sh', 'step', 'continue'], check: o => includes(o.json!.before, 'smoke_g') || (Object.keys(o.json!).join() !== 'ok,did,before,after' && `keys ${Object.keys(o.json!)}`) },
	{ name: 'debug wait paused (second browser())', run: ['debug.sh', 'wait', 'paused', '--timeout', '10'], check: o => includes(o.json!.frame, 'smoke_g') },
	{ name: 'debug step continue to the end', run: ['debug.sh', 'step', 'continue'] },
	{ name: 'debug wait running', run: ['debug.sh', 'wait', 'running', '--timeout', '10'] },

	// ---- Plots, and ui.sh on the Save Plot dialog
	{ name: 'console-run r plot', quick: true, run: ['console-run.sh', '--language', 'r', '--capture', 'plot(1:10, col = "red", pch = 19)'] },
	{ name: 'plots read', quick: true, wait: 1000, run: ['plots.sh', 'read'], check: o => keys(o.json, 'plot', 'zoom', 'toolbar', 'filmstrip', 'devicePixelRatio') || keys(o.json!.plot, 'drawn', 'natural', 'naturalCss', 'box') || (o.json!.blank && 'blank') || (!(o.json!.plot?.pixels?.colours > 1) && 'the image has one colour') || (!/^plot \d+$/.test(o.json!.plot?.name) && `named ${o.json!.plot?.name}`) || logged('plots.sh -s=net1: read Plots: "plot') },
	{ name: 'ui read Plots', quick: true, run: ['ui.sh', 'read', 'Plots'], check: o => includes(o.json!.tree, 'img "plot') },
	{ name: 'ui read missing view', run: ['ui.sh', 'read', 'No Such View'], fail: true },
	{ name: 'plots zoom 50%', run: ['plots.sh', 'zoom', '50%'], check: o => (o.json!.zoom !== '50%' && `zoom ${o.json!.zoom}`) || logged('plots.sh -s=net1: zoom 50% -> Plots: "plot') },
	// A toast comes a moment after the click and closes within seconds: the click reports it.
	{ name: 'ui click Copy Plot (toast)', quick: true, run: ['ui.sh', 'click', 'button', 'Copy Plot to Clipboard', '--in', 'Plots'], check: o => (!o.json!.notification && `no notification: ${JSON.stringify(o.json)}`) || logged('-> toast Info: Plot copied') },
	// The plot copied is on the machine's clipboard; macOS only, and says so elsewhere.
	{ name: 'clipboard read --image', quick: true, run: ['clipboard.sh', 'read', '--image', 'smoke-clip.png'], fail: process.platform !== 'darwin', check: o => process.platform === 'darwin' ? (!(o.json!.image?.width > 0) && `image ${JSON.stringify(o.json!.image)}`) || (!existsSync(String(o.json!.image?.path)) && 'no file') : includes(o.json!.error, 'macOS only') },
	{ name: 'clipboard read --image, file exists', run: ['clipboard.sh', 'read', '--image', 'smoke-clip.png'], fail: true },
	{ name: 'plots save --format PDF', run: ['plots.sh', 'save', '--format', 'PDF'], check: o => includes(o.json!.tree, 'button "Format": PDF') },
	// Any helper that fails with a modal dialog open names the dialog.
	{ name: 'palette-run with the dialog open', run: ['palette-run.sh', '--dry-run', 'View: Show Explorer'], fail: true, check: o => includes(o.json!.error, 'Save Plot') || keys(o.json, 'dialogs') },
	{ name: 'ui read dialog', run: ['ui.sh', 'read', 'dialog'], check: o => includes(o.json!.tree, 'textbox "Name"') },
	{ name: 'ui fill Name', run: ['ui.sh', 'fill', 'Name', 'smoke_plot', '--in', 'dialog'], check: o => includes(o.json!.diff, 'smoke_plot') || includes(o.json!.did, 'fill textbox "Name"') },
	{ name: 'ui type into Name', run: ['ui.sh', 'type', '_x', '--in', 'dialog'], check: o => includes(o.json!.diff, 'smoke_plot_x') },
	{ name: 'ui choose Format SVG', run: ['ui.sh', 'choose', 'button', 'Format', 'SVG', '--in', 'dialog'], check: o => (o.json!.chose !== 'SVG' && `chose ${o.json!.chose}`) || (!o.json!.changed && 'changed is not true') || includes(o.json!.trigger, 'PDF -> SVG') },
	// The Format popup is a dialog of buttons; read menu shows it, and click menuitem reaches its items.
	{ name: 'ui click Format (popup)', run: ['ui.sh', 'click', 'button', 'Format', '--in', 'dialog'], check: o => includes(o.json!.opened, 'a menu: read it with ui.sh read menu') },
	{ name: 'ui read menu (popup)', run: ['ui.sh', 'read', 'menu'], check: o => includes(o.json!.tree, 'PNG') },
	{ name: 'ui click menuitem PNG in the popup', run: ['ui.sh', 'click', 'menuitem', 'PNG', '--in', 'menu'], check: o => includes(o.json!.note, 'closed') },
	{ name: 'ui choose missing item', run: ['ui.sh', 'choose', 'button', 'Format', 'BMP', '--in', 'dialog'], fail: true },
	{ name: 'ui click missing button', run: ['ui.sh', 'click', 'button', 'No Such Button', '--in', 'dialog'], fail: true },
	{ name: 'ui click Cancel', run: ['ui.sh', 'click', 'button', 'Cancel', '--in', 'dialog'], check: o => includes(o.json!.note, 'closed') },
	// A second plot: prev and next step between them, each logged with the plot it left.
	{ name: 'console-run r plot 2', run: ['console-run.sh', '--language', 'r', '--capture', 'plot(1:5, col = "blue", pch = 19)'] },
	{ name: 'plots prev', wait: 1000, run: ['plots.sh', 'prev'], check: o => (o.json!.plot?.name === o.json!.before?.plot?.name && `still ${o.json!.plot?.name}`) || logged('plots.sh -s=net1: click Show Previous Plot -> Plots: "plot') },
	{ name: 'plots read empty --session', run: ['plots.sh', 'read', '--session', ''], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.stderr, '--session needs the session name') },
	{ name: 'plots save --width with no value answers JSON on stdout', run: ['plots.sh', 'save', '--width'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json?.error, '--width needs a value') },
	{ name: 'plots prev at the first plot', run: ['plots.sh', 'prev'], fail: true, check: () => logged('plots.sh -s=net1: FAILED prev: ') },
	{ name: 'plots next', run: ['plots.sh', 'next'], check: o => o.json!.plot?.name === o.json!.before?.plot?.name && `still ${o.json!.plot?.name}` },
	{ name: 'plots open editor', run: ['plots.sh', 'open', 'editor'], check: o => includes(o.json!.opened, 'editor tab "plot') },
	{ name: 'plots read --editor', run: ['plots.sh', 'read', '--editor'], check: o => includes(o.json!.toolbar, 'Save Plot From Active Editor') },
	{ name: 'plots clear', run: ['plots.sh', 'clear'] },
	{ name: 'plots read after clear', wait: 500, run: ['plots.sh', 'read'], check: o => !o.json!.blank && 'a plot is still shown' },

	// ---- Views and the Viewer
	{ name: 'view-read Variables', run: ['view-read.sh', '--view', 'Variables'], check: o => includes(o.text, 'smoke_f') },
	{ name: 'view-read missing view', run: ['view-read.sh', '--view', 'No Such View'], fail: true },
	{ name: 'view-read the view without --view', run: ['view-read.sh', 'Variables'], fail: true, check: o => includes(o.stderr, 'unexpected argument "Variables"') || logged('view-read.sh -s=net1: FAILED Variables: unexpected argument') },
	{ name: 'console-run r opens help', run: ['console-run.sh', '--language', 'r', '?mean'] },
	{ name: 'view-read Help reads the page', wait: 3000, run: ['view-read.sh', '--view', 'Help'], check: o => includes(o.text, 'Arithmetic Mean') },
	{ name: 'ui read Help notes the page it leaves out', run: ['ui.sh', 'read', 'Help'], check: o => includes(o.json!.note, 'view-read.sh --view Help') },
	{ name: 'a flag and its value as one argument', run: ['nb.sh', '--notebook notebook.ipynb', 'read'], fail: true, check: o => includes(o.json?.error, 'is one argument') },
	{ name: 'a bash helper given a flag with no value', run: ['listeners.sh', '--save'], fail: true, check: o => includes(o.stderr, '--save needs a value') },
	{ name: 'monaco-paste an unknown flag answers JSON on stdout', run: ['monaco-paste.sh', '--bogus', 'x'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json?.error, 'unknown flag --bogus') || includes(o.stderr, 'monaco-paste.sh: unknown flag --bogus') },
	{ name: 'monaco-paste empty input answers JSON on stdout', run: ['monaco-paste.sh', ''], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json?.error, 'empty input') || includes(o.stderr, 'monaco-paste.sh: empty input') },
	{ name: 'listeners --diff with a saved list that does not exist', run: ['listeners.sh', '--all', '--diff', '/nonexistent-dp-smoke/listeners-before.txt'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.stderr, 'cannot read the saved list') },
	{ name: 'listeners --diff with an empty file name', run: ['listeners.sh', '--all', '--diff', ''], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.stderr, '--diff needs the saved list\'s file name') },
	{ name: 'listeners --save taking the next flag as its file', run: ['listeners.sh', '--save', '--all'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.stderr, 'not "--all"') },
	// A matplotlib plot has a size of its own (after the Variables reads, which want R's session): a size given unticks Use intrinsic size first.
	{ name: 'console-run python matplotlib plot', run: () => ['console-run.sh', '--language', 'python', '--name', found.py, '--capture', 'import matplotlib.pyplot as plt; plt.plot([1, 2, 3], [2, 1, 3]); plt.show()'] },
	{ name: 'plots save --width (intrinsic size)', wait: 1500, run: ['plots.sh', 'save', '--width', '640'], check: o => includes(o.json!.intrinsicSize, 'unticked') || includes(o.json!.tree, 'spinbutton "Width": "640"') },
	{ name: 'ui click Cancel (intrinsic size)', run: ['ui.sh', 'click', 'button', 'Cancel', '--in', 'dialog'], check: o => includes(o.json!.note, 'closed') },
	{ name: 'console-run r html to Viewer', quick: true, run: ['console-run.sh', '--language', 'r', 'print(htmltools::browsable(htmltools::tags$button("smoke-viewer-button")))'] },
	{ name: 'viewer wait-content', quick: true, run: ['viewer.sh', 'wait-content', '20'], check: o => includes(o.json!.shown, 'smoke-viewer-button') },
	{ name: 'view-read Viewer', quick: true, run: ['view-read.sh', '--view', 'Viewer'], check: o => includes(o.text, 'button "smoke-viewer-button"') },
	{ name: 'viewer buttons', run: ['viewer.sh', 'buttons'], check: o => includes(o.json!.buttons, 'Clear the content') },
	{ name: 'viewer click', run: ['viewer.sh', 'click', 'smoke-viewer-button'], check: o => keys(o.json, 'did', 'changed') },
	{ name: 'viewer click missing', run: ['viewer.sh', 'click', 'No Such Thing'], fail: true },
	{ name: 'viewer empty --session answers JSON on stdout', run: ['viewer.sh', 'read', '--session='], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json?.error, '--session needs the session name') || includes(o.stderr, 'viewer.sh: --session needs the session name') },
	// HTML content's toolbar says "the content" where a URL's says "the current URL".
	{ name: 'viewer reload HTML content', run: ['viewer.sh', 'reload'], check: o => o.json!.clicked !== 'Reload the content' && `clicked ${o.json!.clicked}` },
	{ name: 'viewer clear HTML content', run: ['viewer.sh', 'clear'], check: o => o.json!.clicked !== 'Clear the content' && `clicked ${o.json!.clicked}` },
	{ name: 'viewer clear when empty', run: ['viewer.sh', 'clear'], fail: true },

	// ---- Explorer tree, Data Explorer
	{ name: 'palette-run Show Explorer', quick: true, run: ['palette-run.sh', 'View: Show Explorer'] },
	{ name: 'tree rows Explorer', quick: true, run: ['tree.sh', '--view', 'Explorer', 'rows'], check: o => includes(o.json!.rows, '"text":"cars.csv"') || includes(o.json!.rows, '"state":"leaf"') },
	{ name: 'tree menu missing item', run: ['tree.sh', '--view', 'Explorer', 'menu', 'cars.csv', 'No Such Item'], fail: true },
	{ name: 'tree missing row', run: ['tree.sh', '--view', 'Explorer', 'click', 'no-such-file.txt'], fail: true },
	{ name: 'open-file cars.csv', quick: true, run: ['open-file.sh', 'cars.csv'] },
	{ name: 'de-read cars.csv', quick: true, wait: 1000, run: ['de-read.sh', '--title', 'Data: cars.csv', '--rows', '3'], check: o => (JSON.stringify(o.json!.columns) !== '["model","speed","dist"]' && `columns ${JSON.stringify(o.json!.columns)}`) || (o.json!.rows?.[1]?.model !== 'bravo' && `row 2 ${JSON.stringify(o.json!.rows?.[1])}`) || includes(o.json!.status, '5 rows') },
	{ name: 'de-read wrong title', run: ['de-read.sh', '--title', 'Data: other'], fail: true },
	// The Data Explorer's filter popup: its column list opens inside it, as a popup of its own.
	{ name: 'ui click Add Filter (names the dialog)', run: ['ui.sh', 'click', 'button', 'Add Filter', '--in', 'editor'], check: o => includes(o.json!.opened, 'a dialog: read it with ui.sh read dialog') },
	{ name: 'ui choose a column inside the filter popup', run: ['ui.sh', 'choose', 'button', 'Select Column', 'model', '--in', 'dialog'], check: o => (o.json!.chose !== 'model' && `chose ${o.json!.chose}`) || includes(o.json!.trigger, 'Select Column -> model') },
	{ name: 'ui read dialog (filter popup)', run: ['ui.sh', 'read', 'dialog'], check: o => includes(o.json!.tree, 'button "Select Condition"') || includes(o.json!.tree, 'model') },
	{ name: 'ui choose missing column', run: ['ui.sh', 'choose', 'button', 'model', 'No Such Column', '--in', 'dialog'], fail: true, check: o => includes(o.json!.items, 'speed') },
	{ name: 'ui click blocked by the filter popup', run: ['ui.sh', 'click', 'button', 'Add Filter', '--in', 'editor'], fail: true, check: o => (/\u001b|Call log|locator\(/.test(o.text) && `raw Playwright error: ${o.text.slice(0, 200)}`) || includes(o.json!.error, 'the click on button "Add Filter" in editor did not happen within 3 s: something drawn on top of it took the click; open on top: a dialog') },
	{ name: 'ui choose condition in the filter popup', run: ['ui.sh', 'choose', 'button', 'Select Condition', 'is not empty', '--in', 'dialog'], check: o => includes(o.json!.trigger, 'Select Condition -> is not empty') },
	{ name: 'ui click Apply Filter', run: ['ui.sh', 'click', 'button', 'Apply Filter', '--in', 'dialog'], check: o => includes(o.json!.note, 'closed') },

	// ---- Notebook and Quarto
	{ name: 'open-file notebook.ipynb', quick: true, run: ['open-file.sh', 'notebook.ipynb'] },
	{ name: 'nb read', quick: true, wait: 1000, run: ['nb.sh', '--notebook', 'notebook.ipynb', 'read'], check: o => keys(o.json, 'kernel', 'cells', 'modified') || (o.json!.cells?.length !== 4 && `${o.json!.cells?.length} cells`) },
	{ name: 'nb run 2', run: ['nb.sh', '--notebook', 'notebook.ipynb', 'run', '2'], check: o => includes(o.json!.cell?.output, 'nb-product 42') },
	// Run All Cells is hidden while a cell runs, and the palette's "similar commands"
	// guess is Delete All Notebook Editor Cells: palette-run must refuse, deleting nothing.
	{ name: 'nb run 4 (sleeps 6 s)', run: ['nb.sh', '--notebook', 'notebook.ipynb', 'run', '4'] },
	{ name: 'palette-run Run All Cells while a cell runs', run: ['palette-run.sh', 'Notebook: Run All Cells'], fail: true, check: o => includes(o.json!.error, 'exact title') || includes(o.json!.error, 'nothing was run') || includes(o.json!.hint, 'precondition') },
	{ name: 'nb read: every cell still there', run: ['nb.sh', '--notebook', 'notebook.ipynb', 'read'], check: o => o.json!.cells?.length !== 4 && `${o.json!.cells?.length} cells` },
	{ name: 'nb wait for the sleeping cell', run: ['nb.sh', '--notebook', 'notebook.ipynb', 'wait'] },
	{ name: 'nb wrong notebook', run: ['nb.sh', '--notebook', 'other.ipynb', 'read'], fail: true },
	{ name: 'nb wait --timeout not a number', run: ['nb.sh', '--notebook', 'notebook.ipynb', 'wait', '--timeout', 'abc'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json!.error, '--timeout must be a positive number of seconds') },
	{ name: 'nb type 3 --replace', run: ['nb.sh', '--notebook', 'notebook.ipynb', 'type', '3', '--replace', 'product + 2'], check: o => JSON.stringify(o.json!.source) !== '["product + 2"]' && `source ${JSON.stringify(o.json!.source)}` },
	{ name: 'nb run 3 after typing', run: ['nb.sh', '--notebook', 'notebook.ipynb', 'run', '3'], check: o => o.json!.cell?.output !== '44' && `output ${o.json!.cell?.output}` },
	{ name: 'nb type 2 at the end', run: ['nb.sh', '--notebook', 'notebook.ipynb', 'type', '2', '\n# nb-typed'], check: o => (o.json!.source?.[2] !== '# nb-typed' && `source ${JSON.stringify(o.json!.source)}`) || logged('type "\\n# nb-typed" into cell 2 in notebook.ipynb') },
	{ name: 'nb type into a missing cell', run: ['nb.sh', '--notebook', 'notebook.ipynb', 'type', '9', 'x'], fail: true },
	{ name: 'open-file report.qmd', quick: true, run: ['open-file.sh', 'report.qmd'] },
	{ name: 'qmd cells', run: ['qmd.sh', '--file', 'report.qmd', 'cells'], check: o => o.json!.cells?.length !== 3 && `${o.json!.cells?.length} cells` },
	// run reports the cell before and after the click; wait waits for its Run button to show again.
	{ name: 'qmd run 1', quick: true, run: ['qmd.sh', '--file', 'report.qmd', 'run', '1'], check: o => (!o.json!.changed && 'nothing changed') || keys(o.json!.before, 'toolbar', 'output') },
	{ name: 'qmd wait 1', run: ['qmd.sh', '--file', 'report.qmd', 'wait', '1', '30'], check: o => includes(o.json!.output?.text, 'qmd-answer 42') || includes(o.json!.toolbar?.buttons, 'Run this cell') || logged('qmd.sh -s=net1: read report.qmd cell 1 after wait: completed') },
	{ name: 'qmd read', run: ['qmd.sh', '--file', 'report.qmd', 'read'], check: o => includes(o.json!.outputs, 'qmd-answer 42') },
	{ name: 'qmd stop a finished cell', run: ['qmd.sh', '--file', 'report.qmd', 'stop', '1'], fail: true, check: o => includes(o.json!.error, 'the toolbar shows Run this cell') },
	// The last run's output stays under the cell until the new run prints: run reports only this run's.
	{ name: 'qmd run 1 again', run: ['qmd.sh', '--file', 'report.qmd', 'run', '1'], check: o => o.json!.toolbar?.executionId === o.json!.before?.toolbar?.executionId && 'the execution id did not change' },
	// More cell actions: a menu opening is a change; menu lists and closes it, or chooses.
	{ name: 'qmd button More cell actions', run: ['qmd.sh', '--file', 'report.qmd', 'button', '1', 'More cell actions'], check: o => (!o.json!.changed && 'changed is not true') || includes(o.json!.menu, 'Insert Cell Above') },
	{ name: 'qmd menu 1 (list)', run: ['qmd.sh', '--file', 'report.qmd', 'menu', '1'], check: o => includes(o.json!.items, 'Copy Cell Code') },
	{ name: 'ui read menu (closed)', run: ['ui.sh', 'read', 'menu'], fail: true },
	{ name: 'qmd menu 1 Copy Cell Code', run: ['qmd.sh', '--file', 'report.qmd', 'menu', '1', 'Copy Cell Code'], check: o => o.json!.chose !== 'Copy Cell Code' && `chose ${o.json!.chose}` },
	{ name: 'qmd menu missing item', run: ['qmd.sh', '--file', 'report.qmd', 'menu', '1', 'No Such Item'], fail: true },
	{ name: 'qmd run 3 (long output)', run: ['qmd.sh', '--file', 'report.qmd', 'run', '3'], check: o => !o.json!.changed && 'nothing changed' },
	{ name: 'qmd wait 3', run: ['qmd.sh', '--file', 'report.qmd', 'wait', '3', '30'], check: o => includes(o.json!.output?.kinds, 'truncation-header') },
	{ name: 'qmd link missing', run: ['qmd.sh', '--file', 'report.qmd', 'link', '3', 'no such link'], fail: true },
	// In a short editor the link is off screen: link wheels the editor to it before the click.
	{ name: 'panel resize panel tall (short editor)', run: ['panel.sh', 'resize', 'panel', '700'] },
	{ name: 'qmd link open in editor', run: ['qmd.sh', '--file', 'report.qmd', 'link', '3', 'open in editor'], check: o => (!o.json!.changed && 'nothing changed') || (/report\.qmd/.test(String(o.json!.activeEditor)) && `still ${o.json!.activeEditor}`) || logged('click (open in editor) -> active editor') },
	{ name: 'panel resize panel back', run: ['panel.sh', 'resize', 'panel', '420'] },
	{ name: 'open-file report.qmd again', run: ['open-file.sh', 'report.qmd'] },
	{ name: 'qmd clear 3', run: ['qmd.sh', '--file', 'report.qmd', 'clear', '3'], check: o => (o.json!.output !== null && 'output still there') || (o.json!.cleared !== true && `cleared ${o.json!.cleared}`) || (!o.json!.toolbar && 'no toolbar read') },
	{ name: 'qmd clear 3 again (no output)', run: ['qmd.sh', '--file', 'report.qmd', 'clear', '3'], fail: true },
	{ name: 'qmd wrong file', run: ['qmd.sh', '--file', 'other.qmd', 'cells'], fail: true },
	{ name: 'qmd missing cell', run: ['qmd.sh', '--file', 'report.qmd', 'run', '9'], fail: true },
	// Two report.qmd: the folder picks one, and the tab is checked by its path.
	{ name: 'open-file sub/report.qmd', run: ['open-file.sh', 'sub/report.qmd'], check: o => !String(o.json!.path).endsWith('/ws/sub/report.qmd') && `path ${o.json!.path}` },
	// A cell that prints nothing ran all the same: its execution id says so, each time.
	{ name: 'qmd run a cell that prints nothing', run: ['qmd.sh', '--file', 'report.qmd', 'run', '1'], check: o => (o.json!.toolbar?.executionId === o.json!.before?.toolbar?.executionId && 'the execution id did not change') || (o.json!.output !== null && 'an output') },
	{ name: 'qmd run the cell that reads it', run: ['qmd.sh', '--file', 'report.qmd', 'run', '2'], check: o => !o.json!.changed && 'nothing changed' },
	{ name: 'qmd wait for it', run: ['qmd.sh', '--file', 'report.qmd', 'wait', '2', '30'], check: o => includes(o.json!.output?.text, 'sub-answer 42') },
	{ name: 'open-file report.qmd, the root one', run: ['open-file.sh', 'report.qmd'], check: o => !String(o.json!.path).endsWith('/ws/report.qmd') && `path ${o.json!.path}` },
	// Notebook and Quarto sessions are not consoles: sessions --all lists them.
	{ name: 'panel sessions --all', run: ['panel.sh', 'sessions', '--all'], check: o => (!o.json!.sessions?.some((x: Json) => x.kind === 'notebook' && x.document === 'notebook.ipynb') && `no notebook session: ${JSON.stringify(o.json!.sessions)}`) || (!o.json!.sessions?.some((x: Json) => x.kind === 'quarto' && x.document === 'report.qmd') && 'no quarto session') || (!o.json!.sessions?.some((x: Json) => x.kind === 'console' && x.id) && 'no console session with its id') },

	// ---- Terminal and panel
	{ name: 'palette-run new terminal', quick: true, run: ['palette-run.sh', 'Terminal: Create New Terminal'] },
	{ name: 'terminal-run echo', quick: true, wait: 1500, run: ['terminal-run.sh', 'echo smoke-$((6*7))'], check: o => !o.json!.entered && 'not entered' },
	{ name: 'terminal-run --read', run: ['terminal-run.sh', '--read', '--tail', '5'], check: o => includes(o.json!.text, 'smoke-42') },
	{ name: 'terminal-run stray read', run: ['terminal-run.sh', 'read'], fail: true, check: o => includes(o.json!.error, '--read') },
	// Terminals are numbered from 1: --index 0 is refused, not taken as terminal 1; --tail takes a whole number.
	{ name: 'terminal-run --index 0', run: ['terminal-run.sh', '--index', '0', 'echo smoke-idx0'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json!.error, '--index') },
	{ name: 'terminal-run --tail -2', run: ['terminal-run.sh', '--read', '--tail', '-2'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json!.error, '--tail') },
	// An unknown key name is named, with the right one; the Control pressed before it is released.
	{ name: 'terminal-run unknown key', run: ['terminal-run.sh', '--key', 'Control+BackSpace'], fail: true, check: o => includes(o.json!.error, 'try Backspace') || includes(o.json!.error, 'Control went down and up') },
	{ name: 'panel terminals', run: ['panel.sh', 'terminals'], check: o => keys(o.json, 'terminals') },
	{ name: 'panel tab Console', run: ['panel.sh', 'tab', 'Console'], check: o => includes(o.json!.tab, 'Console') },
	{ name: 'panel tab Console again', run: ['panel.sh', 'tab', 'Console'], check: o => !o.json!.already && 'not reported as already shown' },
	// The Console hides the terminal: terminal-run brings the Terminal view forward itself.
	{ name: 'terminal-run with the Console in front', run: ['terminal-run.sh', 'echo smoke-forward'], check: o => (!o.json!.entered && 'not entered') || includes(o.json!.broughtForward, 'Terminal') },
	{ name: 'panel tab Console back', run: ['panel.sh', 'tab', 'Console'], check: o => o.json!.tab !== 'Console' && `tab ${o.json!.tab}` },
	// A narrow panel folds its tabs into Additional Views; tab goes through its menu.
	{ name: 'panel resize secondary wide', run: ['panel.sh', 'resize', 'secondary', '1300'] },
	{ name: 'panel tab Terminal, narrow panel', run: ['panel.sh', 'tab', 'Terminal'], check: o => includes(o.json!.via, 'Additional Views') },
	// Choosing a view folds another tab away: the tab is checked by name, not by place.
	{ name: 'panel tab Console, narrow panel', run: ['panel.sh', 'tab', 'Console'], check: o => o.json!.tab !== 'Console' && `tab ${o.json!.tab}` },
	{ name: 'panel tab Terminal again, narrow panel', run: ['panel.sh', 'tab', 'Terminal'], check: o => o.json!.tab !== 'Terminal' && `tab ${o.json!.tab}` },
	{ name: 'panel tab missing, narrow panel', run: ['panel.sh', 'tab', 'No Such Tab'], fail: true },
	{ name: 'panel resize secondary back', run: ['panel.sh', 'resize', 'secondary', '300'] },
	{ name: 'panel tab missing', run: ['panel.sh', 'tab', 'No Such Tab'], fail: true },
	// A tab with a badge: its text is "Problems1", its accessible name longer still.
	{ name: 'open-file broken.json', run: ['open-file.sh', 'broken.json'] },
	{ name: 'panel tab Problems (badge)', wait: 1500, run: ['panel.sh', 'tab', 'Problems'], retry: 2, retryOn: /not selected/, check: o => o.json!.tab !== 'Problems' && `tab ${o.json!.tab}` },
	{ name: 'view-read Problems', run: ['view-read.sh', '--view', 'Problems'], check: o => includes(o.text, 'broken.json') },
	// The editor area hidden: its tabs are still listed, and it says so.
	{ name: 'palette-run Toggle Maximized Panel', run: ['palette-run.sh', 'View: Toggle Maximized Panel'] },
	{ name: 'panel editors, editor area hidden', run: ['panel.sh', 'editors'], check: o => (o.json!.editorArea !== 'hidden' && 'editorArea is not hidden') || includes(o.json!.groups, '"title":"analysis.R"') },
	{ name: 'palette-run Toggle Maximized Panel back', run: ['palette-run.sh', 'View: Toggle Maximized Panel'] },
	{ name: 'panel layout', run: ['panel.sh', 'layout'], check: o => keys(o.json, 'window', 'sidebar', 'secondary', 'panel', 'editor') || logged('panel.sh -s=net1: read layout: window 1600x1000') },
	// Dragged below its minimum, a part closes: "hidden", not null.
	{ name: 'palette-run Show Explorer (sidebar)', run: ['palette-run.sh', 'View: Show Explorer'] },
	{ name: 'panel resize sidebar 0', run: ['panel.sh', 'resize', 'sidebar', '0'], check: o => o.json!.now !== 'hidden' && `now ${o.json!.now}` },
	{ name: 'panel delete-session python', run: () => ['panel.sh', 'delete-session', found.py], check: o => !o.json!.deleted && `not deleted: ${JSON.stringify(o.json)}` },
	{ name: 'console-read deleted session', run: () => ['console-read.sh', '--name', found.py], fail: true },

	// ---- Settings
	{ name: 'settings set workspace', quick: true, run: ['settings.sh', 'set', 'smoke.number', '42'], check: o => (o.json!.value !== 42 && `value ${JSON.stringify(o.json!.value)}`) || includes(readFileSync(join(ws, '.vscode/settings.json'), 'utf8'), '"smoke.number": 42') },
	// Merged, not overwritten: the first key is still there.
	{ name: 'settings set workspace, second key', run: ['settings.sh', 'set', 'smoke.text', 'hello'], check: o => includes(readFileSync(String(o.json!.file), 'utf8'), '"smoke.number": 42') || includes(readFileSync(String(o.json!.file), 'utf8'), '"smoke.text": "hello"') },
	{ name: 'settings set --user', run: ['settings.sh', 'set', 'smoke.flag', 'true', '--user'], check: o => (o.json!.scope !== 'user' && `scope ${o.json!.scope}`) || includes(readFileSync(String(o.json!.file), 'utf8'), 'quarto.inlineOutput.enabled') },
	{ name: 'settings set without a value', run: ['settings.sh', 'set', 'smoke.number'], fail: true },

	// ---- Notifications, screenshots, run-app
	{ name: 'notifications list', quick: true, run: ['notifications.sh'], check: o => !Array.isArray(o.json!.notifications) && 'no notifications array' },
	{ name: 'notifications click missing', run: ['notifications.sh', '--click', 'No Such Button'], fail: true },
	{ name: 'notifications clear', run: ['notifications.sh', '--clear'], check: o => keys(o.json, 'remaining') },
	{ name: 'shot window', quick: true, run: ['shot.sh', 'smoke-window.png'], check: o => !existsSync(o.text.trim()) && `no file ${o.text.trim()}` },
	{ name: 'shot one element', run: ['shot.sh', 'smoke-statusbar.png', '.part.statusbar'], check: o => !existsSync(o.text.trim()) && `no file ${o.text.trim()}` },
	{ name: 'shot missing element', run: ['shot.sh', 'smoke-none.png', '.no-such-element'], fail: true },
	{ name: 'shot name lint cannot read', run: ['shot.sh', 'smoke-50%.png'], fail: true, check: o => includes(o.stderr, 'take it as smoke-50.png') },
	{ name: 'open-file analysis.py', run: ['open-file.sh', 'analysis.py'] },
	{ name: 'run-app --list', quick: true, run: ['run-app.sh', '--list'], check: o => keys(o.json, 'buttons') },
	// Language features in Python. With Pyrefly off (the seed), no language
	// server answers in a .py here: hover and Go to Definition fail loud
	// rather than read as nothing.
	{ name: 'editor hover Python (no server)', run: ['editor.sh', 'hover', '--at', '9:10', '--timeout', '1'], fail: true, check: o => includes(o.json!.error, 'no hover showed within 1 s') },
	{ name: 'editor definition Python (no server)', run: ['editor.sh', 'definition', '--at', '9:15', '--timeout', '1'], fail: true, check: o => includes(o.json!.error, 'Go to Definition did nothing') },

	// ---- Windows: last, since a reload restarts the page under every helper
	{ name: 'shot --list', run: ['shot.sh', '--list'], check: o => (o.json!.windows?.length !== 1 && `${o.json!.windows?.length} windows`) || (!o.json!.windows?.[0]?.attached && 'not attached') },
	{ name: 'window select missing', run: ['window.sh', 'select', '9'], fail: true },
	{ name: 'window reload --timeout not a number', run: ['window.sh', 'reload', '--timeout', 'abc'], fail: true, check: o => (o.code !== 2 && `exit ${o.code}`) || includes(o.json!.error, '--timeout must be a positive number of seconds') },
	{ name: 'window reload', quick: true, run: ['window.sh', 'reload'], check: o => (o.json!.folder !== ws && `folder ${o.json!.folder}`) || (!o.json!.title && 'no title') || void (found.reloadDialog = o.json!.dialogs?.[0]?.buttons?.[0] ?? '') || logged('window.sh -s=net1: reload window ->') },
	// Sessions that did not reconnect raise a dialog after the reload, now and then: answer it.
	{ name: 'notifications after the reload', quick: true, run: () => found.reloadDialog ? ['notifications.sh', '--click', found.reloadDialog] : ['notifications.sh'] },
	{ name: 'palette-run after the reload', run: ['palette-run.sh', '--dry-run', 'View: Show Explorer'] },
	{ name: 'window open-folder missing', run: ['window.sh', 'open-folder', join(root, 'no-such-folder')], fail: true },
	{ name: 'window open-folder sub', run: ['window.sh', 'open-folder', join(ws, 'sub')], check: o => (o.json!.folder !== join(ws, 'sub') && `folder ${o.json!.folder}`) || (o.json!.was?.folder !== ws && `was ${JSON.stringify(o.json!.was)}`) },
];

// What each section needs from the ones before it, built on a fresh launch.
const startR: Case = { name: 'setup: start-session r', run: () => ['start-session.sh', '--language', 'r', '--name', found.rName], check: o => (!/^r-/.test(o.json?.sessionId ?? '') && 'sessionId is not r-*') || void (found.r = o.json!.sessionId) };
const newPython: Case = { name: 'setup: start-session python --new', run: () => ['start-session.sh', '--language', 'python', '--name', found.pyName, '--new'], check: o => (!/^python-/.test(o.json?.sessionId ?? '') && 'sessionId is not python-*') || void (found.py = o.json!.sessionId) };
const groups: Group<Case>[] = [
	{ id: 'sessions', first: 'palette-run dry run', setup: [] },
	{ id: 'editor', first: 'open-file analysis.R', setup: [startR] },
	{ id: 'debug', first: 'debug wait running, not debugging', setup: [startR] },
	{ id: 'plots', first: 'console-run r plot', setup: [startR] },
	// R last, so Variables shows R's smoke_f.
	{ id: 'views', first: 'view-read Variables', setup: [newPython, startR, { name: 'setup: console-run r smoke_f', run: ['console-run.sh', '--language', 'r', 'smoke_f <- function(x) { y <- x + 1; y * 2 }'] }] },
	{ id: 'explorer', first: 'palette-run Show Explorer', setup: [] },
	{ id: 'notebook', first: 'open-file notebook.ipynb', setup: [] },
	{ id: 'terminal', first: 'palette-run new terminal', setup: [{ name: 'setup: open-file analysis.R', run: ['open-file.sh', 'analysis.R'] }, newPython] },
	{ id: 'settings', first: 'settings set workspace', setup: [] },
	{ id: 'notifications', first: 'notifications list', setup: [] },
	{ id: 'windows', first: 'shot --list', setup: [] },
];

/** Starts a helper in the background, for a case that watches what it does. */
function background(args: string[]): void {
	spawn('bash', [join(scripts, args[0]), '--session', SESSION, ...args.slice(1)], { cwd: repo, stdio: 'ignore', detached: true, env: { ...process.env, DRIVE_POSITRON_LOG: join(root, 'actions.log') } }).unref();
}

// ---- Running ---------------------------------------------------------------------

function sh(args: string[], stdin?: string, timeout = 120_000): Out {
	const r = spawnSync('bash', args, { cwd: repo, encoding: 'utf8', input: stdin ?? '', timeout, env: { ...process.env, DRIVE_POSITRON_SHOTS: join(root, 'shots'), DRIVE_POSITRON_LOG: join(root, 'actions.log') } });
	const last = (r.stdout ?? '').trim().split('\n').pop() ?? '';
	let json: Json | null = null;
	try { const v = JSON.parse(last); json = v && typeof v === 'object' ? v : null; } catch { /* a text answer */ }
	return { code: r.status ?? (r.error ? 124 : 1), json, text: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
}

/** What is wrong with a case's result, or '' when it passed. */
function judge(c: Case, o: Out): string {
	const said = () => (o.json ? JSON.stringify(o.json) : (o.text + o.stderr).trim()).slice(0, 300);
	if (c.fail) {
		if (o.code === 0) { return `expected a failure, got exit 0: ${said()}`; }
		if (o.json ? o.json.ok !== false || !o.json.error : !o.stderr.trim()) { return `failed without ok:false and an error: ${said()}`; }
		try { return c.check?.(o) || ''; } catch (e) { return `check threw ${String(e)}: ${said()}`; }
	}
	if (o.code !== 0 || (o.json && o.json.ok !== true)) { return `exit ${o.code}: ${said()}`; }
	try { return c.check?.(o) || ''; } catch (e) { return `check threw ${String(e)}: ${said()}`; }
}

let instance: App | null = null;
function cleanup(): void {
	if (!instance) { return; }
	const i = instance;
	instance = null;
	if (keep) {
		console.log(`kept: ${join(scripts, 'stop.sh')} --cdp-port ${i.cdpPort} --run-dir ${i.runDir}`);
		return;
	}
	stopFixture(i);
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) { process.on(sig, () => { cleanup(); process.exit(130); }); }

function launch(): void {
	launchFixture({ session: SESSION, root, appArgs, onStarted: app => { instance = app; writeFileSync(join(root, 'instance.json'), JSON.stringify({ cdpPort: app.cdpPort, runDir: app.runDir })); } });
}

/**
 * A workspace with a .venv starts a Python session by itself; wait for its
 * prompt, so the sessions the cases start do not race it.
 */
function settle(): void {
	for (let i = 0; i < 45; i++) {
		if (sh([join(scripts, 'console-read.sh'), '--session', SESSION, '--language', 'python', '--prompt']).text.trim() === '>>>') { return; }
		spawnSync('sleep', ['2']);
	}
	throw new Error('the Python session the workspace starts was not ready within 90 s');
}

/**
 * The names the session cases ask for, read from what this machine has: the
 * Python session the workspace started, and the first R row of the runtime
 * picker. A CI image can have two R versions and a venv not named positron-python.
 */
function pickNames(): void {
	const s = sh([join(scripts, 'panel.sh'), '--session', SESSION, 'sessions']);
	const py = nameWords(s.json?.sessions?.find((x: Json) => x.language === 'python')?.name ?? '');
	if (!py) { throw new Error(`no Python session name in panel.sh sessions: ${s.text.slice(0, 200)}`); }
	found.pyName = py;
	// Discovery lists R after Python: reopen the picker until it shows an R row, as start-session does.
	let labels: string[] = [];
	let r: string | null = null;
	for (let i = 0; i < 15 && !r; i++) {
		const open = sh([join(scripts, 'palette-run.sh'), '--session', SESSION, 'Interpreter: Start New Console Session']);
		if (!open.json?.ok) { throw new Error(`could not open the runtime picker: ${open.text.slice(0, 200)}`); }
		const rows = sh([join(scripts, 'quickpick-enum.sh'), '--session', SESSION, '--json']);
		spawnSync(join(repo, 'node_modules/.bin/playwright-cli'), [`-s=${SESSION}`, 'press', 'Escape'], { cwd: repo, stdio: 'ignore' });
		// --json prints the object indented, so sh()'s last-line parse misses it.
		let picker: Json = {};
		try { picker = JSON.parse(rows.text); } catch { /* no rows this time */ }
		labels = (picker.rows ?? []).map((x: Json) => x.label);
		r = nameWords(firstRow(picker.rows ?? [], 'r') ?? '');
		if (!r) { spawnSync('sleep', ['2']); }
	}
	if (!r) { throw new Error(`no R row in the runtime picker after 30 s, labels: ${JSON.stringify(labels)}`); }
	found.rName = r;
}

let run: Case[];
const groupOf = new Map<Case, string>();
try {
	groupIds(cases, groups).forEach((id, i) => groupOf.set(cases[i], id));
	for (const g of groups) { for (const c of g.setup) { groupOf.set(c, g.id); } }
	if (own.includes('--list')) { console.log(JSON.stringify(cases.map(c => ({ name: c.name, group: groupOf.get(c) })))); process.exit(0); }
	run = selectCases(cases, { quick: quickOnly, until, fromStart }, groups);
} catch (e) { console.log(String(e instanceof Error ? e.message : e)); process.exit(2); }
const results: SmokeResults = { startedAt: new Date().toISOString(), until, quick: quickOnly, launch: 'FAIL', launchProblem: '', cases: [] };
const start = Date.now();
const tally = { PASS: 0, FAIL: 0, KNOWN: 0 };
let current: { name: string; args: string[]; t0: number; group?: string } | null = null;
try {
	const t = Date.now();
	launch();
	settle();
	pickNames();
	console.log(`PASS ${String(Date.now() - t).padStart(6)} ms  launch, attach, first Python session ready, names: R ${found.rName}, Python ${found.pyName} (cdp ${instance!.cdpPort})`);
	results.launch = 'PASS';
	for (const c of run) {
		if (c.wait) { spawnSync('sleep', [String(c.wait / 1000)]); }
		current = { name: c.name, args: [], t0: Date.now(), group: groupOf.get(c) };
		const args = typeof c.run === 'function' ? c.run() : c.run;
		current.args = args;
		const t0 = current.t0;
		let o = sh([join(scripts, args[0]), '--session', SESSION, ...args.slice(1)], c.stdin);
		let problem = judge(c, o);
		let tries = 1;
		// Something still on its way.
		for (; problem && c.retry && c.retryOn?.test(problem) && tries <= c.retry; tries++) {
			spawnSync('sleep', ['3']);
			o = sh([join(scripts, args[0]), '--session', SESSION, ...args.slice(1)], c.stdin);
			problem = judge(c, o);
		}
		const status = !problem ? 'PASS' : c.known ? 'KNOWN' : 'FAIL';
		tally[status]++;
		current = null;
		results.cases.push({ name: c.name, status, helper: args[0], args: args.slice(1), problem: problem || '', ms: Date.now() - t0, group: groupOf.get(c) });
		console.log(`${status.padEnd(5)}${String(Date.now() - t0).padStart(6)} ms  ${c.name}${tries > 1 ? ` (${tries} tries)` : ''}${c.known && !problem ? '  (listed as known, passed this time: remove the mark once it passes every run)' : ''}`);
		if (problem) { console.log(`       ${c.known ? `known: ${c.known}\n       ` : ''}${problem}`); }
	}
} catch (e) {
	tally.FAIL++;
	if (results.launch === 'FAIL') { results.launchProblem = String(e instanceof Error ? e.message : e); }
	else if (current) { results.cases.push({ ...threwResult(current.name, current.args, e, Date.now() - current.t0), group: current.group }); }
	console.log(`FAIL  ${String(e instanceof Error ? e.message : e)}`);
} finally {
	cleanup();
}
console.log(`${tally.PASS} passed, ${tally.FAIL} failed, ${tally.KNOWN} known failures in ${Math.round((Date.now() - start) / 1000)} s`);
if (resultsFile) { writeFileSync(resultsFile, `${JSON.stringify(results, null, '\t')}\n`); }
process.exitCode = tally.FAIL ? 1 : 0;
