/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const DAEMONS = ['watch-client-transpile', 'watch-client', 'watch-extensions', 'watch-e2e'];

const FINISH_PATTERN: Record<string, RegExp> = {
	'watch-client-transpile': /Finished transpilation/,
	'watch-client': /Finished compilation/,
	'watch-extensions': /Finished compilation/,
	'watch-e2e': /Found \d+ errors?\. Watching for file changes/,
};

const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;
// Matches both 12h (6:12:55 PM) and 24h gulp-style ([18:12:55]) timestamps
const TIMESTAMP_RE = /(?:\[(\d{1,2}:\d{2}:\d{2})\]|(\d{1,2}:\d{2}:\d{2}\s*[AP]M))/;
const DEEMON_MARKER = /\[deemon\] (Spawned|Attached to running) build daemon/;

function getIPCHandle(commandPath: string, args: string[], cwd: string): string {
	const scope = createHash('md5')
		.update(commandPath)
		.update(args.toString())
		.update(cwd)
		.digest('hex');
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\daemon-${scope}`;
	}
	return join(process.env['XDG_RUNTIME_DIR'] || tmpdir(), `daemon-${scope}.sock`);
}

interface DaemonInfo {
	status: 'running' | 'stopped';
	uptime?: string;
	lastCompiled?: string;
}

function checkDaemon(name: string, cwd: string): Promise<'running' | 'stopped'> {
	const handle = getIPCHandle('npm', ['run', name], cwd);
	return new Promise((resolve) => {
		const socket = createConnection(handle, () => {
			socket.destroy();
			resolve('running');
		});
		socket.once('error', () => resolve('stopped'));
	});
}

function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) { return `${seconds}s`; }
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) { return `${minutes}m`; }
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}

async function getSocketUptime(name: string, cwd: string): Promise<string | undefined> {
	const handle = getIPCHandle('npm', ['run', name], cwd);
	try {
		const st = await stat(handle);
		const age = Date.now() - st.birthtimeMs;
		return formatUptime(age);
	} catch {
		return undefined;
	}
}

const TALK = 1;

function getLastCompiled(name: string, cwd: string): Promise<string | undefined> {
	const handle = getIPCHandle('npm', ['run', name], cwd);
	const pattern = FINISH_PATTERN[name];
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			socket.destroy();
			resolve(undefined);
		}, 3000);

		const socket = createConnection(handle, () => {
			socket.write(new Uint8Array([TALK]));
		});

		let pending = '';
		let lastTimestamp: string | undefined;
		let hasFinished = false;

		socket.on('data', (data: Buffer) => {
			pending += data.toString();
			const lines = pending.split('\n');
			pending = lines.pop() || '';
			for (const line of lines) {
				const clean = line.replace(ANSI_ESCAPE, '');
				if (DEEMON_MARKER.test(clean)) {
					clearTimeout(timer);
					socket.destroy();
					resolve(lastTimestamp || (hasFinished ? 'idle' : undefined));
					return;
				}
				if (pattern.test(clean)) {
					hasFinished = true;
					const m = clean.match(TIMESTAMP_RE);
					if (m) { lastTimestamp = m[1] || m[2]; }
				}
			}
		});

		socket.once('error', () => {
			clearTimeout(timer);
			resolve(undefined);
		});
	});
}

async function getDaemonInfo(name: string, cwd: string): Promise<DaemonInfo> {
	const status = await checkDaemon(name, cwd);
	if (status === 'stopped') { return { status }; }

	const [uptime, lastCompiled] = await Promise.all([
		getSocketUptime(name, cwd),
		getLastCompiled(name, cwd),
	]);
	return { status, uptime, lastCompiled };
}

const KILL = 0;

function stopDaemon(name: string, cwd: string): Promise<'killed' | 'not running'> {
	const handle = getIPCHandle('npm', ['run', name], cwd);
	return new Promise((resolve) => {
		const socket = createConnection(handle, () => {
			socket.write(new Uint8Array([KILL]));
			socket.destroy();
			resolve('killed');
		});
		socket.once('error', () => resolve('not running'));
	});
}

async function stopDaemonAndWait(name: string, cwd: string): Promise<'killed' | 'not running'> {
	const result = await stopDaemon(name, cwd);
	if (result === 'killed') {
		// Wait for the daemon to fully exit so its socket becomes non-connectable.
		// Without this, an immediate re-run of --stop can connect to the dying
		// daemon and falsely report another kill.
		for (let i = 0; i < 20; i++) {
			const status = await checkDaemon(name, cwd);
			if (status === 'stopped') { break; }
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	return result;
}

function getWorktrees(): { path: string; branch: string }[] {
	const output = execSync('git worktree list --porcelain', { encoding: 'utf-8' });
	const worktrees: { path: string; branch: string }[] = [];
	let current: { path?: string; branch?: string } = {};
	for (const line of output.split('\n')) {
		if (line.startsWith('worktree ')) {
			current = { path: line.slice('worktree '.length) };
		} else if (line.startsWith('branch ')) {
			current.branch = line.slice('branch '.length).replace('refs/heads/', '');
		} else if (line === '' && current.path) {
			worktrees.push({ path: current.path, branch: current.branch || '(detached)' });
			current = {};
		}
	}
	if (current.path) {
		worktrees.push({ path: current.path, branch: current.branch || '(detached)' });
	}
	return worktrees;
}

const allMode = process.argv.includes('--all');
const jsonMode = process.argv.includes('--json');
const stopMode = process.argv.includes('--stop');
const worktrees = allMode ? getWorktrees() : [{ path: process.cwd(), branch: '' }];

if (stopMode) {
	const allResults = await Promise.all(
		worktrees.map(async (wt) => {
			const statuses = await Promise.all(
				DAEMONS.map((name) => stopDaemonAndWait(name, wt.path))
			);
			const daemons: Record<string, string> = {};
			for (let i = 0; i < DAEMONS.length; i++) {
				daemons[DAEMONS[i]] = statuses[i];
			}
			return { worktree: wt.path, branch: wt.branch, daemons };
		})
	);

	for (const { worktree, branch, daemons } of allResults) {
		if (allMode) {
			// allow-any-unicode-next-line
			console.log(`\n${basename(worktree)} (${branch})\n${'─'.repeat(50)}`);
		}
		for (const name of DAEMONS) {
			if (daemons[name] === 'killed') {
				console.log(`[${name}] killed`);
			}
		}
	}
} else {
	const allResults = await Promise.all(
		worktrees.map(async (wt) => {
			const infos = await Promise.all(
				DAEMONS.map((name) => getDaemonInfo(name, wt.path))
			);
			const daemons: Record<string, DaemonInfo> = {};
			for (let i = 0; i < DAEMONS.length; i++) {
				daemons[DAEMONS[i]] = infos[i];
			}
			return { worktree: wt.path, branch: wt.branch, daemons };
		})
	);

	if (jsonMode) {
		console.log(JSON.stringify(allResults, null, 2));
	} else {
		for (const { worktree, branch, daemons } of allResults) {
			if (allMode) {
				// allow-any-unicode-next-line
				console.log(`\n${basename(worktree)} (${branch})\n${'─'.repeat(50)}`);
			}
			console.log(`${'DAEMON'.padEnd(25)} ${'STATUS'.padEnd(10)} ${'UPTIME'.padEnd(10)} LAST COMPILED`);
			for (const name of DAEMONS) {
				const info = daemons[name];
				const uptime = info.uptime || '-';
				const lastCompiled = info.lastCompiled || '-';
				console.log(`${name.padEnd(25)} ${info.status.padEnd(10)} ${uptime.padEnd(10)} ${lastCompiled}`);
			}
		}
	}
}
