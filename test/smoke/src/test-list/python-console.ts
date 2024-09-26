/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from 'path';
import { setupEnvAndHooks } from './_setup-utils';
import { setup as setupPythonConsoleTest } from '../areas/positron/console/python-console.test';

const fileName = basename(__filename);
const logger = setupEnvAndHooks(fileName);

setupPythonConsoleTest(logger);
