/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { setup as setupVariablesTest } from './areas/positron/variables/variablespane.test';
import { setupDataExplorer100x100Test } from './areas/positron/dataexplorer/data-explorer-100x100.test';
import { setup as setupDataExplorerTest } from './areas/positron/dataexplorer/dataexplorer.test';
import { setup as setupPlotsTest } from './areas/positron/plots/plots.test';
import { setup as setupPythonConsoleTest } from './areas/positron/console/python-console.test';
import { setup as setupRConsoleTest } from './areas/positron/console/r-console.test';
import { opts, setup, setupBeforeHook } from './setupUtils';

const suite = 'Main-0';
const logger = setup(suite);

setupBeforeHook(logger, suite);

describe(`[${suite}] Smoke Tests (${opts.web ? 'Web' : 'Electron'})`, () => {
	setupVariablesTest(logger);
	setupDataExplorerTest(logger);
	setupDataExplorer100x100Test(logger);
	setupPlotsTest(logger);
	setupPythonConsoleTest(logger);
	setupRConsoleTest(logger);
});
