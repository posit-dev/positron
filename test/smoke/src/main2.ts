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
import { DESCRIBE_TITLE, opts, setup, setupBeforeAfterHooks, TEST_SUITES } from './setupUtils';

const logger = setup(TEST_SUITES.MAIN_2);
setupBeforeAfterHooks(logger, TEST_SUITES.MAIN_2);

describe(DESCRIBE_TITLE, () => {
	if (!opts.web) { setupLayoutTest(logger); }
	if (!opts.web) { setupNotebookVariablesTest(logger); }
	if (!opts.web) { setupConsoleInputTest(logger); }
	if (!opts.web) { setupConsoleANSITest(logger); }
	if (!opts.web) { setupConsoleOutputLogTest(logger); }
	if (!opts.web) { setupBasicRMarkdownTest(logger); }
	if (!opts.web) { setupWelcomeTest(logger); }
	if (!opts.web) { setupConsoleHistoryTest(logger); }
	if (!opts.web) { setupShinyTest(logger); }
	if (!opts.web) { setupFastExecutionTest(logger); }
	if (!opts.web) { setupTestExplorerTest(logger); }
	if (!opts.web) { setupRPKgDevelopment(logger); }
	if (!opts.web) { setupInterpreterDropdownTest(logger); }
	if (!opts.web) { setupViewersTest(logger); }
	if (!opts.web) { setupVeryLargeDataFrameTest(logger); }
	if (!opts.web) { setupGraphTrendTest(logger); }
	if (!opts.web) { setupQuartoTest(logger); }
	if (!opts.web) { setupNewProjectWizardTest(logger); }
});
