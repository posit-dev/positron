/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import * as fs from 'fs';
import { provisionTestFiles, prepareTestEnv, defaultWorkspacePath } from '../infra/test-runner';

const ROOT_PATH = process.cwd();
const LOGS_ROOT_PATH = join(ROOT_PATH, 'test-logs');
const WORKSPACE_PATH = defaultWorkspacePath();

async function globalSetup() {
	fs.rmSync(LOGS_ROOT_PATH, { recursive: true, force: true });
	prepareTestEnv(ROOT_PATH, LOGS_ROOT_PATH);
	if (process.env.SKIP_CLONE !== 'true') {
		provisionTestFiles(WORKSPACE_PATH);
	}
}

export default globalSetup;
