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
import { setup, setupBeforeAfterHooks, TEST_SUITES } from './setupUtils';

const suite = TEST_SUITES.MAIN_0;
const logger = setup(suite);

setupBeforeAfterHooks(logger, suite);

describe(`${process.env.SUITE}`, () => {
	setupDataExplorer100x100Test(logger);
	setupVariablesTest(logger);
	setupDataExplorerTest(logger);
	setupPlotsTest(logger);
	setupPythonConsoleTest(logger);
	setupRConsoleTest(logger);
});
