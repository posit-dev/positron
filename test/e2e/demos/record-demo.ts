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

/**
 * Environment variables a `--detached` run withholds from the out-of-tree child. It otherwise gets
 * the caller's whole environment, passed in memory through WMI so that nothing (API keys included)
 * is ever written to disk. These are the agent session's own: ANTHROPIC_BASE_URL breaks Posit
 * Assistant, and ELECTRON_RUN_AS_NODE makes Electron reject its own flags. PowerShell regex.
 */
const WITHHELD_ENV = '^(ANTHROPIC_|CLAUDE|ELECTRON_RUN_AS_NODE$|ELECTRON_NO_ATTACH_CONSOLE$)';

main();

async function main(): Promise<void> {
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
			try {
				fs.rmSync(path.join(ROOT, 'demo-videos', file), { force: true });
			} catch (err) {
				// On Windows a capture that another process is still writing cannot be removed.
				console.error(`Could not remove the stale capture ${file}: ${err}`);
				console.error('If an earlier --detached recording is still running, stop it first (its PID is in %TEMP%\\demo-record-*\\pid.txt).');
				process.exit(1);
			}
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
	// Windows path matches nothing and regex metacharacters in a name change what matches.
	const specFilter = specPath.split(path.sep).join('/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
}

/**
 * Re-run this script outside the caller's process tree and relay its output.
 *
 * On Windows, Ark's libzmq cannot initialise its I/O poller when the kernel is a descendant of an
 * agent session such as Claude Code, so an R session never starts and an R demo recorded from one
 * fails at the `r` fixture. The constraint is on ancestry, not on any single launch, and Playwright
 * has to spawn Electron itself, so the escape is to start the whole recording out of tree. As in
 * drive-positron's launch.sh, the launch goes through WMI: Win32_Process.Create reparents a cmd
 * wrapper to WmiPrvSE, returns its PID so Ctrl+C here can stop the recording, and can start it
 * with no console window. The wrapper runs node, Playwright, Electron, the supervisor and Ark.
 * Output goes to a log file that is streamed back here and the exit code comes back through a
 * marker file, so to the caller this behaves like a normal run.
 */
async function recordDetached(childArgs: string[]): Promise<never> {
	const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-record-'));
	const logFile = path.join(runDir, 'output.log');
	const exitFile = path.join(runDir, 'exit.txt');
	const wrapper = path.join(runDir, 'record.cmd');
	const launcher = path.join(runDir, 'launch.ps1');

	// cmd expands %NAME% even inside quotes; doubling the sign makes it literal. `!` stays literal
	// because delayed expansion is off.
	const cmdLiteral = (s: string) => s.replace(/%/g, '%%');
	const quote = (s: string) => `"${cmdLiteral(s)}"`;

	fs.writeFileSync(wrapper, [
		'@echo off',
		`cd /d ${quote(ROOT)}`,
		`${quote(process.execPath)} --experimental-strip-types ${quote(process.argv[1])} ${childArgs.map(quote).join(' ')} > ${quote(logFile)} 2>&1`,
		'set RC=%ERRORLEVEL%',
		// Written under a temporary name and moved into place so a reader never sees a half-written
		// marker. The space before `>` matters: `echo 1> file` is a handle redirect, not output.
		`echo %RC% > ${quote(`${exitFile}.tmp`)}`,
		`move /y ${quote(`${exitFile}.tmp`)} ${quote(exitFile)} >NUL`,
		'',
	].join('\r\n'));

	// The wrapper path lands in a single-quoted PowerShell string, where a quote is doubled.
	const psQuote = (s: string) => `'${s.replace(/'/g, '\'\'')}'`;
	// A process created through WMI gets the WMI service's environment unless a block is supplied,
	// so PowerShell builds one from the environment it inherited from us. Supplying any block
	// replaces the whole environment, hence everything minus WITHHELD_ENV rather than a short list.
	fs.writeFileSync(launcher, [
		`$block = Get-ChildItem env: | Where-Object { $_.Name -notmatch ${psQuote(WITHHELD_ENV)} } | ForEach-Object { "$($_.Name)=$($_.Value)" }`,
		'$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; EnvironmentVariables = [string[]]$block }',
		'$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `',
		`\t-Arguments @{ CommandLine = ${psQuote(`cmd.exe /d /c "${wrapper}"`)}; ProcessStartupInformation = $startup }`,
		'if ($result.ReturnValue -ne 0) {',
		'\tWrite-Error "Win32_Process.Create failed with ReturnValue $($result.ReturnValue)."',
		'\texit 1',
		'}',
		'$result.ProcessId',
		'',
	].join('\r\n'));

	const launched = spawnSync('powershell.exe', [
		'-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher,
	], { encoding: 'utf-8' });
	const pid = Number((launched.stdout ?? '').trim().split(/\r?\n/).pop());
	if (launched.error || launched.status !== 0 || !Number.isInteger(pid) || pid <= 0) {
		console.error(`Could not start the detached recording through WMI (files in ${runDir}).`);
		console.error(String(launched.error ?? launched.stderr).trim());
		process.exit(1);
	}
	fs.writeFileSync(path.join(runDir, 'pid.txt'), `${pid}\n`);
	console.log(`Recording outside this process tree via WMI (wrapper PID ${pid}); log at ${logFile}`);

	// Ctrl+C here must not leave Electron recording in the background.
	const stop = () => {
		spawnSync('taskkill.exe', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
		console.error(`\nStopped the detached recording (PID ${pid}). Its files are in ${runDir}.`);
		process.exit(130);
	};
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);

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
			const text = fs.readFileSync(exitFile, 'utf-8').trim();
			// Empty means the marker is still being written; `Number('')` would read as success.
			if (text !== '') {
				const code = Number(text);
				if (code === 0) {
					fs.rmSync(runDir, { recursive: true, force: true });
				} else {
					console.error(`\nThe detached recording exited with ${text}; its files are in ${runDir}.`);
				}
				process.exit(Number.isNaN(code) ? 1 : code);
			}
		}
		// The log is created the moment the wrapper starts node, so its absence means the wrapper
		// never ran, however quiet the child may be once it has.
		if (!fs.existsSync(logFile) && Date.now() - startedAt > 60_000) {
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
