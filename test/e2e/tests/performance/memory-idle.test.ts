/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

// No prepare step and no expected roles: idle is the app with nothing done to
// it, which is exactly what settingsMemory.json's manual startup behavior gives.
defineMemoryScenario({ scenario: 'idle' });
