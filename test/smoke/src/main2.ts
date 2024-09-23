/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { setup as setupVariablesTest } from './areas/positron/variables/variablespane.test';
import { setupSmokeTestEnvironment, setupBeforeHook, logger, opts, } from './setupUtils';

setupSmokeTestEnvironment();
setupBeforeHook();

describe(`VSCode Smoke Tests (${opts.web ? 'Web' : 'Electron'})`, () => {
	setupVariablesTest(logger);
});
