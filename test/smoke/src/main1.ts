/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { setup as setupQuartoTest } from './areas/positron/quarto/quarto.test';
import { setupSmokeTestEnvironment, setupBeforeHook, opts, logger, } from './setupUtils';

setupSmokeTestEnvironment();
setupBeforeHook();

describe(`VSCode Smoke Tests (${opts.web ? 'Web' : 'Electron'})`, () => {
	setupQuartoTest(logger);
});
