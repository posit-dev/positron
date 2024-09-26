/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { basename } from 'path';
import { setupDataExplorer100x100Test } from '../areas/positron/dataexplorer/data-explorer-100x100.test';
import { setup, setupBeforeAfterHooks, } from '../setupUtils';

const fileName = basename(__filename);
const logger = setup(fileName);
const web = process.env.WEB;

setupBeforeAfterHooks(logger, fileName);
if (!web) { setupDataExplorer100x100Test(logger); }
