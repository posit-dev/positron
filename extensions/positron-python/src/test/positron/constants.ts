/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

/**
 * Get the path to the user data directory for tests.
 *
 * Uses the environment variable POSITRON_USER_DATA_DIR if set, otherwise creates a new temporary
 * directory and sets the environment variable.
 *
 * @returns The path to the user data directory.
 */
export async function getUserDataDir(): Promise<string> {
    if (!process.env.POSITRON_USER_DATA_DIR) {
        process.env.POSITRON_USER_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'positron-'));
    }
    return process.env.POSITRON_USER_DATA_DIR;
}
