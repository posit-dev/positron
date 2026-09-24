/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// canvas-lab: a long-lived Canvas harness an agent can drive across many tool
// calls. `serve` launches Positron through CanvasHarness (the same profile,
// assistant loading, and window monitoring the Canvas e2e spec uses) and
// answers the other subcommands over a localhost HTTP endpoint recorded in
// the session file. See README.md next to this file.

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { AssistantSource, CanvasHarness, SwitchRoute } from '../../infra/canvasHarness';
import { formatTimeline, visibleOverlaps } from '../../infra/windowTimeline';
import { Canvas } from '../../pages/canvas';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const LAB_DIR = process.env.CANVAS_LAB_DIR ?? path.join(REPO_ROOT, '.build', 'canvas-lab');
const SESSION_FILE = path.join(LAB_DIR, 'session.json');

interface Session {
	readonly port: number;
	readonly token: string;
	readonly pid: number;
	readonly root: string;
	readonly artifactsDir: string;
	readonly folders: Readonly<Record<string, string>>;
}

// One string per line: in a template literal the usage text's indentation
// would be source indentation.
const USAGE = [
	'canvas-lab: drive a live Positron-hosted Canvas across many calls.',
	'',
	'  canvas-lab serve [--vsix] [--assistant <path>] [--folder <name|path>] [--canvas] [--trust]',
	'                   [--folders A,B,C] [--no-video] [--trace] [--keep]',
	'      Launch once and keep it up (run it in the background). Prints the session.',
	'  canvas-lab run <step> [args...]    One harness step; prints JSON.',
	'  canvas-lab windows                 Native windows (id, title, visible, minimized, focused).',
	'  canvas-lab timeline [--since <ms>] Native window timeline of the current launch; overlaps.',
	'  canvas-lab shot [label]            Screenshot every on-screen window.',
	'  canvas-lab eval [--window <id>] <expr>',
	'                                     Evaluate in the IDE window\'s page (or window <id>\'s).',
	'  canvas-lab eval-canvas <expr>      Evaluate in the Canvas webview\'s inner document.',
	'  canvas-lab eval-main <body>        Run a function body in the Electron main process;',
	'                                     `electron` is in scope, `return` a JSON-able value.',
	'  canvas-lab stop                    Kill the app and end the server.',
	'',
	'Steps: enter | exit | active | recents | menu | pick <folder> | choose <folder> |',
	'       switch <folder> [picker|dialog|command] | refusal | dismiss | settled <folder> |',
	'       ide-settled <folder> | cmd <commandId> [json args...] | type <text> | press <key> |',
	'       quit | kill |',
	'       launch [<folder>|--restore] [--canvas] | status',
	'       (choose without a folder leaves the folder dialog open; type/press go to the IDE window)',
	'',
	'Env: CANVAS_ASSISTANT_PATH (assistant packages/positron dir, dist built),',
	'     CANVAS_ASSISTANT_VSIX (with --vsix), CANVAS_LAB_DIR (session file and',
	'     artifacts; default <repo>/.build/canvas-lab).',
].join('\n');

// --- Server ---

async function serve(argv: string[]): Promise<void> {
	const flag = (name: string) => argv.includes(`--${name}`);
	const value = (name: string) => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	if (fs.existsSync(SESSION_FILE)) {
		const existing = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) as Session;
		if (isAlive(existing.pid)) {
			throw new Error(`A canvas-lab server is already running (pid ${existing.pid}); run 'canvas-lab stop' first.`);
		}
	}
	const assistantPath = value('assistant') ?? (flag('vsix') ? process.env.CANVAS_ASSISTANT_VSIX : process.env.CANVAS_ASSISTANT_PATH);
	if (!assistantPath) {
		throw new Error(`Pass --assistant or set ${flag('vsix') ? 'CANVAS_ASSISTANT_VSIX' : 'CANVAS_ASSISTANT_PATH'}.`);
	}
	const assistant: AssistantSource = { kind: flag('vsix') ? 'vsix' : 'dev', path: assistantPath };
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const artifactsDir = path.join(LAB_DIR, 'runs', stamp);
	const harness = await CanvasHarness.create({
		assistant,
		artifactsDir,
		folders: value('folders')?.split(','),
		workspaceTrust: flag('trust'),
		trusted: flag('trust') ? [value('folder') ?? 'A'] : undefined,
		video: !flag('no-video'),
		trace: flag('trace'),
	});

	const token = randomBytes(16).toString('hex');
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', chunk => body += chunk);
		req.on('end', async () => {
			let status = 200;
			let result: unknown;
			try {
				if (req.headers.authorization !== `Bearer ${token}`) {
					status = 403;
					throw new Error('bad token');
				}
				const { cmd, args } = JSON.parse(body) as { cmd: string; args: string[] };
				result = await handle(harness, cmd, args, () => shutdown());
			} catch (error) {
				status = status === 200 ? 500 : status;
				result = { error: error instanceof Error ? error.message : String(error) };
			}
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(result, null, 2));
		});
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;

	let stopping = false;
	const shutdown = async () => {
		if (stopping) {
			return;
		}
		stopping = true;
		await harness.dispose();
		if (!flag('keep')) {
			harness.removeProfile();
		}
		fs.rmSync(SESSION_FILE, { force: true });
		server.close();
		process.exit(0);
	};
	process.once('SIGINT', () => void shutdown());
	process.once('SIGTERM', () => void shutdown());

	await harness.launch({ folder: value('folder') ?? 'A', canvas: flag('canvas') });
	const session: Session = { port, token, pid: process.pid, root: harness.root, artifactsDir, folders: harness.folders };
	fs.mkdirSync(LAB_DIR, { recursive: true });
	fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
	console.log(JSON.stringify({ ready: true, ...session, token: undefined }, null, 2));
}

async function handle(harness: CanvasHarness, cmd: string, args: string[], stop: () => Promise<void>): Promise<unknown> {
	switch (cmd) {
		case 'windows':
			return harness.windows();
		case 'timeline': {
			const samples = await harness.timeline();
			const since = args[0] === '--since' ? Number(args[1]) : 0;
			const slice = samples.filter(s => s.t >= since);
			return { timeline: formatTimeline(slice, samples[0]?.t), overlaps: visibleOverlaps(slice), now: Date.now() };
		}
		case 'shot':
			return harness.shot(args[0] ?? 'lab');
		case 'eval': {
			// --window <id> targets another window's workbench page by native id.
			if (args[0] === '--window') {
				for (const page of harness.code.electronApp!.windows()) {
					if (await page.evaluate(() => (window as unknown as { vscodeWindowId?: number }).vscodeWindowId).catch(() => undefined) === Number(args[1])) {
						return page.evaluate(args.slice(2).join(' '));
					}
				}
				throw new Error(`No page for window ${args[1]}`);
			}
			return harness.code.driver.currentPage.evaluate(args.join(' '));
		}
		case 'eval-canvas': {
			const page = await harness.canvas.page(10_000);
			const handle = await Canvas.frame(page).locator(':root').elementHandle();
			const frame = await handle!.ownerFrame();
			return frame!.evaluate(args.join(' '));
		}
		case 'eval-main':
			return harness.code.electronApp!.evaluate(async (electron, body) => {
				const fn = new Function('electron', `return (async () => { ${body} })();`);
				return fn(electron);
			}, args.join(' '));
		case 'run':
			return runStep(harness, args[0], args.slice(1));
		case 'stop':
			setTimeout(() => void stop(), 100);
			return { stopping: true };
		default:
			throw new Error(`Unknown command '${cmd}'`);
	}
}

async function runStep(harness: CanvasHarness, step: string, args: string[]): Promise<unknown> {
	const t = Date.now();
	const done = (result: unknown) => ({ step, ms: Date.now() - t, result });
	switch (step) {
		case 'status':
			return done({ running: harness.running, launchDir: harness.currentLaunchDir, folders: harness.folders, windows: harness.running ? await harness.windows() : [] });
		case 'enter':
			return done(await harness.canvas.enter());
		case 'exit':
			return done(await harness.canvas.exit());
		case 'active':
			return done(await harness.canvas.isActive());
		case 'recents':
			return done(await harness.canvas.recentFolders());
		case 'menu': {
			const rows = await harness.canvas.workspaceRows();
			await harness.canvas.closeWorkspaceMenu();
			return done(rows);
		}
		case 'pick':
			await harness.canvas.clickWorkspaceRow(harness.folder(args[0]));
			return done('clicked');
		case 'choose':
			await harness.canvas.clickOpenExistingFolder();
			if (args[0]) {
				await harness.answerFolderDialog(args[0]);
			}
			return done(args[0] ? 'answered' : 'dialog open');
		case 'switch':
			return done(await harness.switchFolder(args[0], (args[1] as SwitchRoute | undefined) ?? 'picker'));
		case 'refusal':
			return done(await harness.canvas.refusal() ?? null);
		case 'dismiss':
			await harness.canvas.dismissRefusal();
			return done('dismissed');
		case 'settled':
			await harness.expectCanvasSettled(args[0]);
			return done('settled');
		case 'ide-settled':
			await harness.expectIdeSettled(args[0]);
			return done('settled');
		case 'type':
			await harness.code.driver.currentPage.keyboard.type(args.join(' '));
			return done('typed');
		case 'press':
			await harness.code.driver.currentPage.keyboard.press(args[0]);
			return done('pressed');
		case 'cmd':
			return done(await harness.code.driver.executeCommand(args[0], ...args.slice(1).map(a => JSON.parse(a))));
		case 'quit':
			await harness.quit();
			return done('quit');
		case 'kill':
			await harness.kill();
			return done('killed');
		case 'launch':
			await harness.launch({ folder: args.includes('--restore') ? null : args.find(a => !a.startsWith('--')), canvas: args.includes('--canvas') });
			return done('launched');
		default:
			throw new Error(`Unknown step '${step}'`);
	}
}

// --- Client ---

async function call(cmd: string, args: string[]): Promise<void> {
	if (!fs.existsSync(SESSION_FILE)) {
		throw new Error(`No canvas-lab session (${SESSION_FILE}); start one with 'canvas-lab serve'.`);
	}
	const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) as Session;
	const response = await fetch(`http://127.0.0.1:${session.port}/`, {
		method: 'POST',
		headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ cmd, args }),
	});
	const text = await response.text();
	const parsed = JSON.parse(text);
	// Timelines read better as text than as an escaped JSON string.
	if (cmd === 'timeline' && typeof parsed.timeline === 'string') {
		console.log(parsed.timeline);
		console.log(JSON.stringify({ overlaps: parsed.overlaps, now: parsed.now }, null, 2));
	} else {
		console.log(JSON.stringify(parsed, null, 2));
	}
	if (!response.ok) {
		process.exitCode = 1;
	}
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function main(): Promise<void> {
	const [cmd, ...args] = process.argv.slice(2);
	if (!cmd || cmd === 'help' || cmd === '--help') {
		console.log(USAGE);
		return;
	}
	if (cmd === 'serve') {
		await serve(args);
	} else {
		await call(cmd, args);
	}
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
