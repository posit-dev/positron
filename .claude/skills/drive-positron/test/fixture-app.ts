/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Launches one Positron on a copy of fixture/ and attaches a Playwright session
// to it; the smoke test and the heal finder both start their instance here.
//
//   node .claude/skills/drive-positron/test/fixture-app.ts launch --session S --root DIR --state FILE [-- APP ARGS...]
//   node .claude/skills/drive-positron/test/fixture-app.ts stop --session S --root DIR --state FILE
//
// launch writes {"cdpPort","runDir"} to FILE and prints it; stop reads FILE, so
// a relaunch is always the instance a later stop targets.

import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { flagValue, unknownArg } from './smoke-lib.ts';

const test = dirname(fileURLToPath(import.meta.url));
const scripts = resolve(test, '../scripts');
const repo = resolve(test, '../../../..');
const cli = join(repo, 'node_modules/.bin/playwright-cli');

export interface App { session: string; root: string; cdpPort: number; runDir: string }

function sh(root: string, args: string[], timeout = 120_000) {
	const r = spawnSync('bash', args, { cwd: repo, encoding: 'utf8', input: '', timeout, env: { ...process.env, DRIVE_POSITRON_SHOTS: join(root, 'shots'), DRIVE_POSITRON_LOG: join(root, 'actions.log') } });
	const last = (r.stdout ?? '').trim().split('\n').pop() ?? '';
	let json: { ok?: boolean; cdpPort?: number; runDir?: string } | null = null;
	try { const v = JSON.parse(last); json = v && typeof v === 'object' ? v : null; } catch { /* a text answer */ }
	return { json, stderr: r.stderr ?? '' };
}

/** onStarted runs once the app is up, before attach and the wait, so a caller can stop it if those throw. */
export function launchFixture(opts: { session: string; root: string; appArgs: string[]; onStarted?: (app: App) => void }): App {
	const { session, root, appArgs } = opts;
	const ws = join(root, 'ws');
	rmSync(root, { recursive: true, force: true });
	mkdirSync(join(root, 'seed/User'), { recursive: true });
	cpSync(join(test, 'fixture'), ws, { recursive: true });
	symlinkSync(join(repo, 'extensions/positron-python/.venv'), join(ws, '.venv'));
	writeFileSync(join(root, 'seed/User/settings.json'), JSON.stringify({ 'quarto.inlineOutput.enabled': true, 'positron.notebook.enabled': true, 'workbench.startupEditor': 'none' }, null, '\t'));
	const r = sh(root, [join(scripts, 'launch.sh'), '--source-user-data-dir', join(root, 'seed'), '--no-pyrefly', '--', '--folder-uri', `file://${ws}`, ...appArgs], 600_000);
	if (!r.json?.cdpPort) { throw new Error(`launch.sh failed: ${r.stderr.trim().split('\n').slice(-5).join(' | ')}`); }
	const app: App = { session, root, cdpPort: r.json.cdpPort, runDir: r.json.runDir! };
	opts.onStarted?.(app);
	const a = spawnSync(cli, [`-s=${session}`, 'attach', `--cdp=http://127.0.0.1:${app.cdpPort}`], { cwd: repo, encoding: 'utf8' });
	if (a.status !== 0) { throw new Error(`attach failed: ${a.stdout}${a.stderr}`); }
	spawnSync(cli, [`-s=${session}`, 'resize', '1600', '1000'], { cwd: repo, stdio: 'ignore' });
	// Ready when the palette answers.
	for (let i = 0; i < 30; i++) {
		if (sh(root, [join(scripts, 'palette-run.sh'), '--session', session, '--dry-run', 'View: Show Explorer']).json?.ok) { return app; }
		spawnSync('sleep', ['2']);
	}
	throw new Error('the workbench did not answer within 60 s');
}

/** True when the instance stopped. */
export function stopFixture(app: App, opts?: { keep?: boolean }): boolean {
	if (opts?.keep) { return true; }
	spawnSync(cli, [`-s=${app.session}`, 'close'], { cwd: repo, stdio: 'ignore' });
	const s = spawnSync('bash', [join(scripts, 'stop.sh'), '--cdp-port', String(app.cdpPort), '--run-dir', app.runDir], { cwd: repo, encoding: 'utf8' });
	console.log(s.status === 0 ? 'instance stopped' : `stop.sh failed: ${s.stderr.trim().split('\n').pop()}`);
	rmSync(app.root, { recursive: true, force: true });
	return s.status === 0;
}

function isMain(): boolean {
	try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}

function main(): number {
	const dash = process.argv.indexOf('--');
	const own = process.argv.slice(2, dash < 0 ? undefined : dash);
	const appArgs = dash < 0 ? [] : process.argv.slice(dash + 1);
	const bad = unknownArg(own, ['--session', '--root', '--state'], ['launch', 'stop']);
	if (bad !== null) { console.log(`fixture-app: unknown argument ${JSON.stringify(bad)}`); return 2; }
	const value = (name: string): string | null => {
		const v = flagValue(own, name);
		if (v instanceof Error) { console.log(`fixture-app: ${v.message}`); process.exit(2); }
		return v;
	};
	const session = value('--session');
	const root = value('--root');
	const state = value('--state');
	if (!session || !root || !state || (own[0] !== 'launch' && own[0] !== 'stop')) {
		console.log('usage: fixture-app.ts launch --session S --root DIR --state FILE [-- APP ARGS...] | stop --session S --root DIR --state FILE');
		return 2;
	}
	if (own[0] === 'launch') {
		let started: App | null = null;
		try {
			const app = launchFixture({ session, root, appArgs, onStarted: a => { started = a; } });
			writeFileSync(state, JSON.stringify({ cdpPort: app.cdpPort, runDir: app.runDir }));
			console.log(JSON.stringify({ cdpPort: app.cdpPort, runDir: app.runDir }));
			return 0;
		} catch (e) {
			if (started) { stopFixture(started); }
			throw e;
		}
	}
	if (!existsSync(state)) { console.log(`fixture-app: no state file ${state}`); return 1; }
	const { cdpPort, runDir } = JSON.parse(readFileSync(state, 'utf8')) as { cdpPort: number; runDir: string };
	if (!stopFixture({ session, root, cdpPort, runDir })) { return 1; }
	rmSync(state, { force: true });
	return 0;
}

if (isMain()) {
	try { process.exitCode = main(); } catch (e) { console.log(`fixture-app: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; }
}
