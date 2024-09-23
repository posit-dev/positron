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
import { setup as setupLargeDataFrameTest } from './areas/positron/dataexplorer/largeDataFrame.test';
import { setup as setupNotebookCreateTest } from './areas/positron/notebook/notebookCreate.test';
import { setup as setupConnectionsTest } from './areas/positron/connections/dbConnections.test';
import { setup as setupNewProjectWizardTest } from './areas/positron/new-project-wizard/new-project.test';
import { setup as setupXLSXDataFrameTest } from './areas/positron/dataexplorer/xlsxDataFrame.test';
import { setup as setupHelpTest } from './areas/positron/help/help.test';
import { setup as setupClipboardTest } from './areas/positron/console/consoleClipboard.test';
import { setup as setupTopActionBarTest } from './areas/positron/top-action-bar/top-action-bar.test';
import { setupSmokeTestEnvironment, setupBeforeHook, opts, logger, } from './setupUtils';

setupSmokeTestEnvironment();
setupBeforeHook();

describe(`[Main 1] Smoke Tests (${opts.web ? 'Web' : 'Electron'})`, () => {
	setupVariablesTest(logger);
	setupDataExplorerTest(logger);
	setupDataExplorer100x100Test(logger);
	setupPlotsTest(logger);
	setupPythonConsoleTest(logger);
	setupRConsoleTest(logger);
	setupLargeDataFrameTest(logger);
	setupNotebookCreateTest(logger);
	setupConnectionsTest(logger);
	setupNewProjectWizardTest(logger);
	setupXLSXDataFrameTest(logger);
	setupHelpTest(logger);
	setupClipboardTest(logger);
	setupTopActionBarTest(logger);
});
