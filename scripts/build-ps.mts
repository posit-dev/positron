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
const worktrees = allMode ? getWorktrees() : [{ path: process.cwd(), branch: '' }];

for (const wt of worktrees) {
	const results = await Promise.all(
		DAEMONS.map(async (name) => ({ name, status: await checkDaemon(name, wt.path) }))
	);

	if (allMode) {
		console.log(`\n${basename(wt.path)} (${wt.branch})`);
		console.log(`${'─'.repeat(50)}`);
	}
	console.log(`${'DAEMON'.padEnd(25)} STATUS`);
	for (const { name, status } of results) {
		console.log(`${name.padEnd(25)} ${status}`);
	}
}
