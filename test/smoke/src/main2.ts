/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { setup as setupLayoutTest } from './areas/positron/layouts/layouts.test';
import { setup as setupConsoleInputTest } from './areas/positron/console/consoleInput.test';
import { setup as setupConsoleOutputLogTest } from './areas/positron/output/consoleOutputLog.test';
import { setup as setupBasicRMarkdownTest } from './areas/positron/rmarkdown/rmarkdown.test';
import { setup as setupWelcomeTest } from './areas/positron/welcome/welcome.test';
import { setup as setupConsoleHistoryTest } from './areas/positron/console/consoleHistory.test';
import { setup as setupShinyTest } from './areas/positron/apps/shiny.test';
import { setup, setupBeforeAfterHooks, WORKERS } from './setupUtils';

const suite = WORKERS.MAIN_2;
const logger = setup(suite);

setupBeforeAfterHooks(logger, suite);

describe(`${process.env.SUITE}`, () => {
	setupLayoutTest(logger);
	setupConsoleInputTest(logger);
	setupConsoleOutputLogTest(logger);
	setupBasicRMarkdownTest(logger);
	setupWelcomeTest(logger);
	setupConsoleHistoryTest(logger);
	setupShinyTest(logger);
});
