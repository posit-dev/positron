/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { spawn } from 'node:child_process';

const DAEMONS = ['watch-client', 'watch-extensions', 'watch-e2e'];
const DEEMON_MISSING = /\[deemon\] No daemon running/;

/**
 * Checks if a deemon daemon is running by attaching to it briefly.
 * If the daemon is not running, deemon prints "No daemon running" and exits
 * quickly. If the daemon IS running, deemon attaches and starts streaming
 * replayed output — so if we haven't seen "No daemon running" after a short
 * wait, the daemon is running.
 */
function checkDaemon(name: string): Promise<'running' | 'stopped'> {
	return new Promise((resolve) => {
		const child = spawn('npx', ['deemon', '--attach', '--', 'npm', 'run', name], {
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: true,
		});

		let resolved = false;
		const done = (status: 'running' | 'stopped') => {
			if (resolved) {
				return;
			}
			resolved = true;
			clearTimeout(runningTimeout);
			child.kill();
			resolve(status);
		};

		let output = '';
		const onData = (data: { toString(): string }) => {
			output += data.toString();
			if (DEEMON_MISSING.test(output)) {
				done('stopped');
			}
		};
		child.stdout.on('data', onData);
		child.stderr.on('data', onData);

		// If the process exits quickly without "No daemon running", it's an
		// unexpected state — treat as stopped.
		child.on('close', () => done('stopped'));

		// If we haven't seen "No daemon running" after 3 seconds, the daemon
		// must be running (deemon is replaying its output).
		const runningTimeout = setTimeout(() => done('running'), 3_000);
	});
}

const results = await Promise.all(
	DAEMONS.map(async (name) => ({ name, status: await checkDaemon(name) }))
);

console.log(`${'DAEMON'.padEnd(20)} STATUS`);
for (const { name, status } of results) {
	console.log(`${name.padEnd(20)} ${status}`);
}
