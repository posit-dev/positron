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
import { opts, setup, setupBeforeAfterHooks } from './setupUtils';

const suite = 'Main-0';
const logger = setup(suite);

setupBeforeAfterHooks(logger, suite);

describe(`[${suite}] Smoke Tests (${opts.web ? 'Web' : 'Electron'})`, () => {

	// const logger = setup(TEST_SUITES.MAIN_0);
	// setupBeforeAfterHooks(logger, TEST_SUITES.MAIN_0);
	// describe(DESCRIBE_TITLE, () => {
	console.log('&&&&', opts.web);
	setupVariablesTest(logger);
	setupDataExplorerTest(logger);

	if (!opts.web) { setupDataExplorer100x100Test(logger); }
	if (!opts.web) { setupPlotsTest(logger); }
	if (!opts.web) { setupPythonConsoleTest(logger); }
	if (!opts.web) { setupRConsoleTest(logger); }
});
