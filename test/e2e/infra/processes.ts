/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess } from 'child_process';
import { promisify } from 'util';
import treeKill from 'tree-kill';
import { Logger } from './logger';

export async function teardown(p: ChildProcess, logger: Logger, retryCount = 3): Promise<void> {
	const pid = p.pid;
	if (typeof pid !== 'number') {
		return;
	}

	// --- Start Positron ---
	// On macOS CI, use SIGKILL to forcefully terminate stubborn child processes
	// (extension host, kernels, language servers) that may ignore SIGTERM
	const signal = (process.platform === 'darwin' && process.env.CI) ? 'SIGKILL' : 'SIGTERM';
	// --- End Positron ---

	let retries = 0;
	while (retries < retryCount) {
		retries++;

		try {
			// --- Start Positron ---
			return await promisify(treeKill)(pid, signal);
			// --- End Positron ---
		} catch (error) {
			try {
				process.kill(pid, 0); // throws an exception if the process doesn't exist anymore
				logger.log(`Error tearing down process (pid: ${pid}, attempt: ${retries}): ${error}`);
			} catch (error) {
				return; // Expected when process is gone
			}
		}
	}

	logger.log(`Gave up tearing down process client after ${retries} attempts...`);
}
