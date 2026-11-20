/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { GitResult, GitRunner } from './ports';

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Creates a runner that executes `git` with `gitPath` in `cwd`. Every call sets
 * `GIT_TERMINAL_PROMPT=0` so git never waits for a password, `LC_ALL=C` so output is
 * parseable, and `GIT_OPTIONAL_LOCKS=0` so read-only commands never take the index lock.
 * A call that outlives `timeoutMs` (default 30 seconds) is killed and resolves with
 * `timedOut: true`. With `binary: true` the output strings are decoded as latin1, so
 * `Buffer.from(stdout, 'latin1')` recovers the exact bytes.
 */
export function createGitRunner(gitPath: string, cwd: string): GitRunner {
	return (args, options = {}) => new Promise<GitResult>(resolve => {
		const encoding = options.binary ? 'latin1' : 'utf8';
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const isWindows = process.platform === 'win32';
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let settled = false;

		const finish = (exitCode: number, timedOut: boolean, extraStderr = '') => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			resolve({
				stdout: Buffer.concat(stdout).toString(encoding),
				stderr: Buffer.concat(stderr).toString(encoding) + extraStderr,
				exitCode,
				timedOut,
			});
		};

		let child;
		try {
			child = spawn(gitPath, args, {
				cwd,
				env: {
					...process.env,
					...options.env,
					GIT_TERMINAL_PROMPT: '0',
					LC_ALL: 'C',
					GIT_OPTIONAL_LOCKS: '0',
				},
				stdio: ['pipe', 'pipe', 'pipe'],
				// A separate process group lets a time-out stop git together with
				// any helper it started, such as a credential prompt.
				detached: !isWindows,
				windowsHide: true,
			});
		} catch (error) {
			resolve({ stdout: '', stderr: String(error), exitCode: -1, timedOut: false });
			return;
		}

		const timer = setTimeout(() => {
			killTree(child.pid);
			finish(-1, true);
		}, timeoutMs);

		child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
		child.on('error', error => finish(-1, false, String(error)));
		child.on('close', code => finish(code ?? -1, false));

		// Git may exit before reading all of stdin.
		child.stdin.on('error', () => { });
		child.stdin.end(options.stdin === undefined ? undefined : Buffer.from(options.stdin as string | Uint8Array));
	});
}

function killTree(pid: number | undefined): void {
	if (pid === undefined) {
		return;
	}
	try {
		if (process.platform === 'win32') {
			process.kill(pid);
		} else {
			process.kill(-pid, 'SIGKILL');
		}
	} catch {
		// The process already exited.
	}
}

/**
 * Splits NUL-separated (`-z`) git output into its entries. A trailing terminator
 * produces no empty last entry.
 */
export function splitZ(output: string): string[] {
	if (output === '') {
		return [];
	}
	const parts = output.split('\0');
	if (parts[parts.length - 1] === '') {
		parts.pop();
	}
	return parts;
}
