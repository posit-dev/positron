/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from 'path';

import { setupEnvAndHooks } from './setupUtils';
import { setup as setupInterpreterDropdownTest } from '../areas/positron/top-action-bar/interpreter-dropdown.test';

const fileName = basename(__filename);
const logger = setupEnvAndHooks(fileName);

setupInterpreterDropdownTest(logger);
