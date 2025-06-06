/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { cloneTestRepo, prepareTestEnv, getDeterministicUserDataDir } from '../infra/test-runner';
import { copyKeybindings } from '../infra/test-runner/utils.js';

const ROOT_PATH = process.cwd();
const LOGS_ROOT_PATH = join(ROOT_PATH, 'test-logs');
const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');

const userKeyBindingsPath = join(ROOT_PATH, 'test/e2e/infra/fixtures/keybindings.json');

async function globalSetup() {
	fs.rmSync(LOGS_ROOT_PATH, { recursive: true, force: true });
	prepareTestEnv(ROOT_PATH, LOGS_ROOT_PATH);
	cloneTestRepo(WORKSPACE_PATH);
	const userDataDir = getDeterministicUserDataDir(TEST_DATA_PATH);

	await copyKeybindings(userKeyBindingsPath, userDataDir);
}

export default globalSetup;
