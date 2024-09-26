/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from 'path';
import { setup as setupFastExecutionTest } from '../areas/positron/editor/fast-execution.test';
import { setup, setupBeforeAfterHooks, } from '../setupUtils';

const fileName = basename(__filename);
const logger = setup(fileName);

setupBeforeAfterHooks(logger, fileName);
setupFastExecutionTest(logger);
