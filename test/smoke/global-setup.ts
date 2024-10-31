/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import * as os from 'os';
import { rmSync } from 'fs';
import { prepareTestEnv, cloneTestRepo } from './src/test-runner';

export const ROOT_PATH = join(__dirname, '..', '..');
const LOGS_ROOT_PATH = join(ROOT_PATH, '.build', 'logs');
const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');

async function globalSetup() {
	rmSync(LOGS_ROOT_PATH, { recursive: true, force: true });
	prepareTestEnv(ROOT_PATH);
	cloneTestRepo(WORKSPACE_PATH);
}

export default globalSetup;
