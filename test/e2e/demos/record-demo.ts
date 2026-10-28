/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Record a demo and produce a shippable MP4 in one step.
 *
 *   npm run demo:record                               # the only demo in test/e2e/demos/
 *   npm run demo:record -- my-feature                 # test/e2e/demos/my-feature.demo.test.ts
 *   npm run demo:record -- test/e2e/demos/my-feature.demo.test.ts
 *   npm run demo:record -- my-feature --keep-webm     # keep the raw capture
 *
 * Demo specs are scratch. You write one to get a video and then delete it, so `test/e2e/demos/`
 * normally holds exactly one and naming it is optional.
 *
 * Extra flags are passed through to Playwright, except --keep-webm which belongs to the
 * post-processing step.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEMO_DIR = path.dirname(process.argv[1]);
const ROOT = path.resolve(DEMO_DIR, '../../..');

const args = process.argv.slice(2);
if (args.includes('--detached')) {
	if (process.platform === 'win32') {
		await recordDetached(args.filter(a => a !== '--detached'));
	} else {
		console.log('--detached only applies to Windows; recording in this process.');
	}
}
const keepWebm = args.includes('--keep-webm');
const rest = args.filter(a => a !== '--keep-webm' && a !== '--detached');
const target = rest[0] && !rest[0].startsWith('-') ? rest[0] : null;
const passthrough = target ? rest.slice(1) : rest;

const specPath = target ? resolveSpec(target) : soleSpec();
if (!fs.existsSync(path.resolve(ROOT, specPath))) {
	console.error(`No demo spec at ${specPath}`);
	process.exit(1);
}

const name = path.basename(specPath).replace(/\.demo\.test\.ts$/, '');

// Stale captures would make the post-processing step pick the wrong file.
for (const file of fs.existsSync(path.join(ROOT, 'demo-videos')) ? fs.readdirSync(path.join(ROOT, 'demo-videos')) : []) {
	if (file.endsWith('.webm')) {
		fs.rmSync(path.join(ROOT, 'demo-videos', file), { force: true });
	}
}

// Playwright captures video through its own ffmpeg build, a separate download from the system
// ffmpeg the post-processing step uses. When the build matching the installed Playwright version
// is missing (a Playwright bump with no `playwright install` afterwards), page initialization
// hangs silently until the app fixture times out and no capture is ever written. `install ffmpeg`
// is a quick no-op when the build is already present.
const ffmpegInstall = spawnSync(process.execPath, [
	path.join(ROOT, 'node_modules', 'playwright', 'cli.js'), 'install', 'ffmpeg',
], { cwd: ROOT, stdio: 'inherit' });
if (ffmpegInstall.status !== 0) {
	console.error('\nCould not install the ffmpeg build Playwright needs for video capture.');
	process.exit(ffmpegInstall.status ?? 1);
}

// Run the Playwright CLI through the current node binary rather than through `npx`. On Windows
// `npx` is a `.cmd` shim, which `spawnSync` cannot start without a shell (ENOENT), and going
// through a shell would mean quoting every pass-through argument. The entry point is the same
// file the `npx playwright` shim ends up loading.
const playwrightCli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
// Playwright treats the file argument as a regex over POSIX-style paths, so a backslash-joined
// Windows path matches nothing.
const specFilter = specPath.split(path.sep).join('/');
const playwright = spawnSync(process.execPath, [
	playwrightCli, 'test', specFilter,
	'--project', 'e2e-electron',
	'--reporter', 'list',
	'--timeout', '300000',
	'--workers', '1',
	...passthrough,
], {
	cwd: ROOT,
	stdio: 'inherit',
	env: { ...process.env, DEMO_RECORD_VIDEO: '1' },
});

if (playwright.status !== 0) {
	console.error('\nRecording failed; not post-processing. The raw capture is in demo-videos/.');
	process.exit(playwright.status ?? 1);
}

const post = spawnSync(process.execPath, [
	'--experimental-strip-types',
	path.join(DEMO_DIR, 'postprocess-demo-video.ts'),
	'--name', name,
	...(keepWebm ? ['--keep-webm'] : []),
], { cwd: ROOT, stdio: 'inherit' });

process.exit(post.status ?? 0);

/**
 * Re-run this script outside the caller's process tree and relay its output.
 *
 * On Windows, Ark's libzmq cannot initialise its I/O poller when the kernel is a descendant of an
 * agent session such as Claude Code, so an R session never starts and an R demo recorded from one
 * fails at the `r` fixture. The constraint is on ancestry, not on any single launch, and Playwright
 * has to spawn Electron itself, so the escape is to start the whole recording through Explorer:
 * it becomes the parent of cmd, node, Playwright, Electron, the supervisor and Ark. Output goes to
 * a log file that is streamed back here and the exit code comes back through a marker file, so to
 * the caller this behaves like a normal run.
 */
async function recordDetached(childArgs: string[]): Promise<never> {
	const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-record-'));
	const logFile = path.join(runDir, 'output.log');
	const exitFile = path.join(runDir, 'exit.txt');
	const launcher = path.join(runDir, 'record.cmd');
	const quote = (s: string) => `"${s}"`;

	fs.writeFileSync(launcher, [
		'@echo off',
		// Explorer runs the script in a visible console. Re-enter minimised and let that window go.
		'if "%~1"=="" (start "" /min "%~f0" run & exit /b 0)',
		`cd /d ${quote(ROOT)}`,
		`${quote(process.execPath)} --experimental-strip-types ${quote(process.argv[1])} ${childArgs.map(quote).join(' ')} > ${quote(logFile)} 2>&1`,
		'set RC=%ERRORLEVEL%',
		// The space before the redirect matters: `echo 1> file` is a handle redirect, not output.
		`echo %RC% > ${quote(exitFile)}`,
		'',
	].join('\r\n'));

	console.log(`Recording outside this process tree via Explorer; log at ${logFile}`);
	spawnSync('explorer.exe', [launcher], { stdio: 'ignore' });

	let offset = 0;
	const drain = () => {
		if (!fs.existsSync(logFile)) {
			return;
		}
		const fd = fs.openSync(logFile, 'r');
		try {
			const size = fs.fstatSync(fd).size;
			if (size > offset) {
				const chunk = Buffer.alloc(size - offset);
				fs.readSync(fd, chunk, 0, chunk.length, offset);
				process.stdout.write(chunk);
				offset = size;
			}
		} finally {
			fs.closeSync(fd);
		}
	};

	const startedAt = Date.now();
	for (; ;) {
		drain();
		if (fs.existsSync(exitFile)) {
			drain();
			const code = Number(fs.readFileSync(exitFile, 'utf-8').trim());
			process.exit(Number.isNaN(code) ? 1 : code);
		}
		if (offset === 0 && Date.now() - startedAt > 60_000) {
			console.error(`The detached recording never started; nothing was written to ${logFile}.`);
			process.exit(1);
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
}

/** Accept either a path or a bare demo name. */
function resolveSpec(value: string): string {
	if (value.endsWith('.ts')) {
		return value;
	}
	return path.join('test', 'e2e', 'demos', `${value}.demo.test.ts`);
}

/** The demo to record when none was named. Ambiguity is the user's to resolve, not ours. */
function soleSpec(): string {
	const found = fs.readdirSync(DEMO_DIR).filter(f => f.endsWith('.demo.test.ts'));
	if (found.length === 1) {
		return path.join('test', 'e2e', 'demos', found[0]);
	}
	if (found.length === 0) {
		console.error('No demo spec in test/e2e/demos/. Write a <name>.demo.test.ts first.');
	} else {
		console.error(`Several demos in test/e2e/demos/; name one: ${found.map(f => f.replace(/\.demo\.test\.ts$/, '')).join(', ')}`);
	}
	process.exit(1);
}
