/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { cloneTestRepo, prepareTestEnv } from '../test-runner';
import { join } from 'path';
import * as os from 'os';

export const ROOT_PATH = join(__dirname, '..', '..', '..', '..');
const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');

async function globalSetup() {
	prepareTestEnv(ROOT_PATH);
	cloneTestRepo(WORKSPACE_PATH);
}

export default globalSetup;
