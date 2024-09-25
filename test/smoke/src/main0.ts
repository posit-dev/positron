/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { setup as setupVariablesTest } from './areas/positron/variables/variablespane.test';
import { setup as setupNotebookVariablesTest } from './areas/positron/variables/notebookVariables.test';
import { setup as setupDataExplorerTest } from './areas/positron/dataexplorer/dataexplorer.test';
import { setup as setupPythonConsoleTest } from './areas/positron/console/python-console.test';
import { setup as setupRConsoleTest } from './areas/positron/console/r-console.test';
import { setup, setupBeforeAfterHooks, WORKERS } from './setupUtils';

const suite = WORKERS.MAIN_0;
const logger = setup(suite);

setupBeforeAfterHooks(logger, suite);

describe(`${process.env.SUITE}`, () => {
	setupNotebookVariablesTest(logger);
	setupVariablesTest(logger);
	setupDataExplorerTest(logger);
	setupPythonConsoleTest(logger);
	setupRConsoleTest(logger);
});
