/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// import { _electron as electron, ElectronApplication } from '@playwright/test';
import { cloneTestRepo, prepareTestEnv } from '../test-runner';
import { join } from 'path';
import * as os from 'os';
import { test as setup } from '@playwright/test';
// let electronApp: ElectronApplication;

const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');

setup('setup test environment', async ({ }) => {
	prepareTestEnv();
	cloneTestRepo(WORKSPACE_PATH);
});
