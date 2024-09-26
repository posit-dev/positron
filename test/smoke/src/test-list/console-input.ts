/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from 'path';
import { setupEnvAndHooks } from './setupUtils';
import { setup as setupConsoleInputTest } from '../areas/positron/console/consoleInput.test';

const fileName = basename(__filename);
const logger = setupEnvAndHooks(fileName);

setupConsoleInputTest(logger);
