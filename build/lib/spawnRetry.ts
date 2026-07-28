/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';

/**
 * Transient, resource-related spawn failures that are worth retrying. On macOS,
 * `posix_spawn` (used by libuv under the hood) throws `EBADF` when the parent
 * process momentarily has a very large number of open file descriptors, even
 * when it is nowhere near its descriptor rlimit. `EAGAIN` / `EMFILE` / `ENFILE`
 * are the classic "out of resources, try again shortly" siblings.
 */
const RETRYABLE_SPAWN_CODES = new Set(['EBADF', 'EAGAIN', 'EMFILE', 'ENFILE']);

/**
 * Spawn a child process, retrying when the spawn call itself fails with a
 * transient, resource-related error.
 *
 * The Positron `vscode-*` gulp targets briefly push the build process's open
 * file-descriptor high-water mark very high: packaging the many data-driver
 * extensions runs `esbuild` / `tsgo` child processes at the same time as a
 * large `gulp.src` glob over every production `node_modules` tree. When a spawn
 * lands inside that spike, macOS `posix_spawn` rejects it with `spawn EBADF`
 * even though the process is far from its descriptor rlimit. The condition is
 * transient -- once the glob stream drains, the descriptor count drops and the
 * spawn succeeds -- so a short, capped exponential backoff rides out the spike
 * without having to serialize the two pipelines.
 *
 * `cp.spawn` reports `EBADF` by throwing synchronously (rather than emitting an
 * `error` event), so a plain try/catch around the call is sufficient to catch
 * and retry it.
 *
 * @returns the successfully launched child process; callers attach their
 *          `stdout` / `stderr` / `exit` listeners to it as usual.
 */
export async function spawnWithRetry(command: string, args: readonly string[], options: cp.SpawnOptions, maxRetries = 15): Promise<cp.ChildProcess> {
	for (let attempt = 0; ; attempt++) {
		try {
			return cp.spawn(command, args as string[], options);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException)?.code;
			if (attempt >= maxRetries || !code || !RETRYABLE_SPAWN_CODES.has(code)) {
				throw err;
			}
			// Back off (capped at 1s) to let the descriptor spike drain, then retry.
			const delayMs = Math.min(1000, 50 * Math.pow(2, attempt));
			await new Promise<void>(resolve => setTimeout(resolve, delayMs));
		}
	}
}
