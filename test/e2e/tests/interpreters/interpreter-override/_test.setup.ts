/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, TestFixtures, WorkerFixtures } from '../../_test.setup';
import { buildPythonPath, buildRPath } from '../helpers/include-excludes.js';

// Write the interpreter override settings BEFORE the app launches, so the app's first (and only)
// discovery runs against the override and the non-override interpreters are never registered.
// Applying the override after a discovery has already run does not work: a warm window reload does
// not unregister already-discovered interpreters (see runtimeStartup.ts:996), so an overridden-away
// interpreter would survive the reload and remain startable. Isolating these tests in their own
// spec (own worker -> own app) keeps that pre-launch discovery clean.
export const test = base.extend<TestFixtures, WorkerFixtures>({
	beforeApp: [
		async ({ settingsFile }, use) => {
			await settingsFile.append({
				'python.interpreters.override': [buildPythonPath('override')],
				'positron.r.interpreters.override': [buildRPath('override')],
			});
			await use();
		},
		{ scope: 'worker' }
	],
});
