/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { basename } from 'path';
import { setupEnvAndHooks } from './setupUtils';
import { setupDataExplorer100x100Test } from '../areas/positron/dataexplorer/data-explorer-100x100.test';

const fileName = basename(__filename);
const logger = setupEnvAndHooks(fileName);
const web = process.env.WEB;

if (!web) { setupDataExplorer100x100Test(logger); }
