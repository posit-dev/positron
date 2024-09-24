/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { setup as setupLargeDataFrameTest } from './areas/positron/dataexplorer/largeDataFrame.test';
import { setup as setupNotebookCreateTest } from './areas/positron/notebook/notebookCreate.test';
import { setup as setupConnectionsTest } from './areas/positron/connections/dbConnections.test';
import { setup as setupXLSXDataFrameTest } from './areas/positron/dataexplorer/xlsxDataFrame.test';
import { setup as setupHelpTest } from './areas/positron/help/help.test';
import { setup as setupClipboardTest } from './areas/positron/console/consoleClipboard.test';
import { setup as setupTopActionBarTest } from './areas/positron/top-action-bar/top-action-bar.test';
import { opts, setup } from './setupUtils';

const suite = 'Main 1';
const logger = setup(suite);

describe(`${suite} Smoke Tests (${opts.web ? 'Web' : 'Electron'})`, () => {
	setupLargeDataFrameTest(logger);
	setupNotebookCreateTest(logger);
	setupConnectionsTest(logger);
	setupXLSXDataFrameTest(logger);
	setupHelpTest(logger);
	setupClipboardTest(logger);
	setupTopActionBarTest(logger);
});
