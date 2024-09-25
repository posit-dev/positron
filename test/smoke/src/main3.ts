/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { setup as setupFastExecutionTest } from './areas/positron/editor/fast-execution.test';
import { setup as setupInterpreterDropdownTest } from './areas/positron/top-action-bar/interpreter-dropdown.test';
import { setup as setupTestExplorerTest } from './areas/positron/test-explorer/test-explorer.test';
import { setup as setupRPKgDevelopment } from './areas/positron/r-pkg-development/r-pkg-development.test';
import { setup as setupViewersTest } from './areas/positron/viewer/viewer.test';
import { setup as setupVeryLargeDataFrameTest } from './areas/positron/dataexplorer/veryLargeDataFrame.test';
import { setup as setupGraphTrendTest } from './areas/positron/dataexplorer/sparklinesTrend.test';
import { setup as setupQuartoTest } from './areas/positron/quarto/quarto.test';
import { setup as setupNewProjectWizardTest } from './areas/positron/new-project-wizard/new-project.test';
import { setup as setupConsoleANSITest } from './areas/positron/console/consoleANSI.test';
import { setup, setupBeforeAfterHooks, WORKERS } from './setupUtils';

const suite = WORKERS.MAIN_3;
const logger = setup(suite);

setupBeforeAfterHooks(logger, suite);

describe(`${process.env.SUITE}`, () => {
	setupFastExecutionTest(logger);
	setupTestExplorerTest(logger);
	setupRPKgDevelopment(logger);
	setupInterpreterDropdownTest(logger);
	setupViewersTest(logger);
	setupVeryLargeDataFrameTest(logger);
	setupGraphTrendTest(logger);
	setupQuartoTest(logger);
	setupNewProjectWizardTest(logger);
	setupConsoleANSITest(logger);
});
