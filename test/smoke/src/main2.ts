/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { setup as setupLayoutTest } from './areas/positron/layouts/layouts.test';
import { setup as setupNotebookVariablesTest } from './areas/positron/variables/notebookVariables.test';
import { setup as setupConsoleInputTest } from './areas/positron/console/consoleInput.test';
import { setup as setupConsoleANSITest } from './areas/positron/console/consoleANSI.test';
import { setup as setupConsoleOutputLogTest } from './areas/positron/output/consoleOutputLog.test';
import { setup as setupBasicRMarkdownTest } from './areas/positron/rmarkdown/rmarkdown.test';
import { setup as setupWelcomeTest } from './areas/positron/welcome/welcome.test';
import { setup as setupConsoleHistoryTest } from './areas/positron/console/consoleHistory.test';
import { setup as setupShinyTest } from './areas/positron/apps/shiny.test';
import { setup as setupFastExecutionTest } from './areas/positron/editor/fast-execution.test';
import { setup as setupInterpreterDropdownTest } from './areas/positron/top-action-bar/interpreter-dropdown.test';
import { setup as setupTestExplorerTest } from './areas/positron/test-explorer/test-explorer.test';
import { setup as setupRPKgDevelopment } from './areas/positron/r-pkg-development/r-pkg-development.test';
import { setup as setupViewersTest } from './areas/positron/viewer/viewer.test';
import { setup as setupVeryLargeDataFrameTest } from './areas/positron/dataexplorer/veryLargeDataFrame.test';
import { setup as setupGraphTrendTest } from './areas/positron/dataexplorer/sparklinesTrend.test';
import { setup as setupQuartoTest } from './areas/positron/quarto/quarto.test';
import { setup as setupNewProjectWizardTest } from './areas/positron/new-project-wizard/new-project.test';
import { setup, setupBeforeAfterHooks, TEST_SUITES } from './setupUtils';

const suite = TEST_SUITES.MAIN_2;
const logger = setup(suite);

setupBeforeAfterHooks(logger, suite);
describe(`[${suite}] ${process.env.SUITE}`, () => {
	setupLayoutTest(logger);
	setupNotebookVariablesTest(logger);
	setupConsoleInputTest(logger);
	setupConsoleANSITest(logger);
	setupConsoleOutputLogTest(logger);
	setupBasicRMarkdownTest(logger);
	setupWelcomeTest(logger);
	setupConsoleHistoryTest(logger);
	setupShinyTest(logger);
	setupFastExecutionTest(logger);
	setupTestExplorerTest(logger);
	setupRPKgDevelopment(logger);
	setupInterpreterDropdownTest(logger);
	setupViewersTest(logger);
	setupVeryLargeDataFrameTest(logger);
	setupGraphTrendTest(logger);
	setupQuartoTest(logger);
	setupNewProjectWizardTest(logger);
});
