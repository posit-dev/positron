/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';

/**
 * Removes a temp directory that a provider catalog watcher was watching.
 *
 * On Windows, closing an `fs.watch` watcher releases its directory handle on
 * a later event loop turn, so deleting the directory right after disposing
 * the watcher fails with EPERM/ENOTEMPTY. This must be async: `fs.rmSync`
 * retries block the event loop, so the handle would never get released.
 */
export async function removeTempDir(dir: string): Promise<void> {
	await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
