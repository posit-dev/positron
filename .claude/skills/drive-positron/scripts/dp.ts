/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// drive-positron's TypeScript helpers, one command per call:
//
//   node dp.ts palette-run --session NAME 'Console: Focus on Console View'
//
// Each command sends one Playwright function to the attached session with
// `playwright-cli run-code` (dp-lib.ts), so it costs one CLI call and uses
// Playwright's own clicks and waits. The .sh files of the same names are
// wrappers that keep their usage text. Commands live by area:
//   dp-palette.ts palette-run, open-file: the Command Palette and Quick Open
//   dp-console.ts start-session, console-run, console-read
//   dp-notifications.ts notifications: toasts and modal dialogs
//   dp-shot.ts  shot: screenshots, and the app's windows
//   dp-terminal.ts terminal-run: a terminal's input and text
//   dp-run-app.ts run-app: the active editor's Run App button
//   dp-ui.ts    ui: read, click, fill, check, choose, type, pick in any view
//   dp-editor.ts editor: read, goto, type, key, select, delete, insert, save, run
//   dp-plots.ts plots read, select, remove: the Plots pane's own reads
//   dp-qmd.ts   qmd: Quarto cells, their toolbars and inline output
//   dp-nb.ts    nb: Positron notebook cells, by the notebook's accessibility tree
//   dp-viewer.ts viewer: the Viewer's toolbar and the page in its frames
//   dp-panel.ts panel: panel tabs, terminals, sessions, editor tabs, part sizes
//   dp-tree.ts  tree: rows of a tree view, expand, collapse, click, context menu
//   dp-de.ts    de-read: the Data Explorer grid's headers, rows and status
//   dp-settings.ts settings: a setting merged into the user or workspace settings.json
//   dp-clipboard.ts clipboard: the machine's clipboard, its text or image (macOS)
//   dp-window.ts window: reload, open a folder, a new window, which one is driven
// and `help X.sh`, which prints a bash script's header for its --help,
// `log X.sh SESSION TEXT`, a bash recipe's line in the action log, and
// `fail X.sh SESSION OUTPUT ARGS...`, its failure's line, and
// `usage X.sh ERROR`, a bash helper's usage error: {"ok":false,"error"} on
// stdout (the answer every JSON helper gives), "X.sh: ERROR" on stderr, exit 2.
// Shared: dp-lib.ts (Node side: run-code, log, parsing, help), page-lib.ts
// (the `lib` page functions get), selectors.ts (every selector and name).

import { Exit, explainFailure, failureText, logFailure, logLine, usage, type Json } from './dp-lib.ts';
import { paletteCommands } from './dp-palette.ts';
import { consoleCommands } from './dp-console.ts';
import { notificationsCommands } from './dp-notifications.ts';
import { shotCommands } from './dp-shot.ts';
import { terminalCommands } from './dp-terminal.ts';
import { runAppCommands } from './dp-run-app.ts';
import { uiCommands } from './dp-ui.ts';
import { editorCommands } from './dp-editor.ts';
import { plotsCommands } from './dp-plots.ts';
import { qmdCommands } from './dp-qmd.ts';
import { nbCommands } from './dp-nb.ts';
import { viewerCommands } from './dp-viewer.ts';
import { panelCommands } from './dp-panel.ts';
import { treeCommands } from './dp-tree.ts';
import { deCommands } from './dp-de.ts';
import { settingsCommands } from './dp-settings.ts';
import { clipboardCommands } from './dp-clipboard.ts';
import { windowCommands } from './dp-window.ts';

const commands: Record<string, (argv: string[]) => Json | string> = {
	// `dp.ts help X.sh`: the -h|--help of the bash scripts, which prints X.sh's header.
	help: argv => usage(argv[0] ?? ''),
	// `dp.ts log X.sh SESSION TEXT`: a bash recipe's line in the action log, cut to one line.
	log: argv => {
		if (!argv.length || /^(-h|--help)$/.test(argv[0])) { return LOG_USAGE; }
		logLine(argv[0], argv[1] ?? '', argv.slice(2).join(' '));
		return '';
	},
	// `dp.ts fail X.sh SESSION OUTPUT ARGS...`: a bash recipe's failure, with the error from its JSON output.
	fail: argv => { logLine(argv[0] ?? '', argv[1] ?? '', failureText(argv.slice(3), errorOf(argv[2] ?? ''))); return ''; },
	...paletteCommands, ...consoleCommands, ...notificationsCommands, ...shotCommands, ...terminalCommands, ...runAppCommands, ...uiCommands, ...editorCommands, ...plotsCommands, ...qmdCommands, ...nbCommands, ...viewerCommands, ...panelCommands, ...treeCommands, ...deCommands, ...settingsCommands, ...clipboardCommands, ...windowCommands };

const LOG_USAGE = `usage: node dp.ts log NAME SESSION TEXT...

Appends one line to the action log ($DRIVE_POSITRON_LOG), stamped with the
UTC time as every helper's line is: "<time> NAME -s=SESSION: TEXT". It is the
only way to log what no helper logged: a script of your own, a raw
playwright-cli call, a shell step, or an action you notice you missed, logged
as a note when you notice it:

  node dp.ts log rec.sh positron 'start: console state every 50 ms'
  node dp.ts log note '' 'at ~03:58 I pressed Escape in report.qmd, not logged then'

NAME says what did it (your script's name, raw, shell, note); SESSION is the
Playwright session, or '' for none. The log is append-only: never write to it
another way, and never edit, reorder or backdate a line.`;

/** The error in a command's JSON answer, or the answer itself when it is not JSON. */
function errorOf(out: string): string {
	try { const j = JSON.parse(out.trim().split('\n').pop() ?? ''); return String(j?.error ?? out); } catch { return out.trim(); }
}

function main(): number {
	const [name, ...argv] = process.argv.slice(2);
	// `dp.ts usage X.sh ERROR`: a bash helper whose stdout is JSON refuses its
	// arguments the way the TypeScript helpers do, so a caller reading stdout
	// gets the error; stderr keeps the text for a person at a terminal.
	if (name === 'usage') {
		const error = argv.slice(1).join(' ');
		process.stderr.write(`${(argv[0] ?? '').split('/').pop()}: ${error}\n`);
		process.stdout.write(JSON.stringify({ ok: false, error }) + '\n');
		return 2;
	}
	const command = commands[name];
	if (!command) { process.stdout.write(JSON.stringify({ ok: false, error: `command: ${Object.keys(commands).join(', ')}` }) + '\n'); return 2; }
	// Every failure leaves a line in the action log, so a negative check has its evidence there.
	const failed = (error: unknown) => {
		// Only the session is needed here; read it directly, since parse refuses the
		// very arguments a failure may be about.
		const at = argv.findIndex(a => a === '--session' || a.startsWith('--session='));
		const session = at < 0 ? String(process.env.PW_SESSION ?? '') : argv[at].includes('=') ? argv[at].slice('--session='.length) : argv[at + 1] ?? '';
		const args = argv.filter((a, i) => !/^--session(=|$)/.test(a) && argv[i - 1] !== '--session');
		logFailure(`${name}.sh`, session, args, String(error ?? ''));
	};
	try {
		const raw = command(argv);
		const out = typeof raw === 'string' ? raw : explainFailure(raw);
		process.stdout.write((typeof out === 'string' ? out : JSON.stringify(out)) + '\n');
		if (typeof out !== 'string' && !out.ok) { failed(out.error); }
		return typeof out === 'string' || out.ok ? 0 : 1;
	} catch (e) {
		if (!(e instanceof Exit)) { throw e; }
		const out = e.out && typeof e.out !== 'string' && e.code === 1 ? explainFailure(e.out) : e.out;
		if (out) { process.stdout.write((typeof out === 'string' ? out : JSON.stringify(out)) + '\n'); }
		if (e.code !== 0) { failed(e.reason || (typeof out === 'string' ? out : out.error)); }
		return e.code;
	}
}

process.exitCode = main();

