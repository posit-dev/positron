/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const DAEMONS = ['watch-client-transpile', 'watch-client', 'watch-extensions', 'watch-e2e'];

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
			const statuses = await Promise.all(
				DAEMONS.map((name) => checkDaemon(name, wt.path))
			);
			const daemons: Record<string, string> = {};
			for (let i = 0; i < DAEMONS.length; i++) {
				daemons[DAEMONS[i]] = statuses[i];
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
			console.log(`${'DAEMON'.padEnd(25)} STATUS`);
			for (const name of DAEMONS) {
				console.log(`${name.padEnd(25)} ${daemons[name]}`);
			}
		}
	}
}
