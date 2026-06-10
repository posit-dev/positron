/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './interpreter-override.setup.js';
import { buildPythonPath, buildRPath, expectSessionStartToFail } from './helpers/include-excludes.js';

test.use({
	suiteId: __filename
});

// The override settings are written before the app launches (see interpreter-override.setup.ts), so the only
// interpreters ever discovered are the override ones. Starting any non-override interpreter must
// therefore fail.
test.describe('Interpreter: Override', {
	tag: [tags.INTERPRETER]
}, () => {
	test('R - Can Override Interpreter Discovery', { tag: [tags.ARK] }, async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'r', buildRPath('override'));
	});

	test('Python - Can Override Interpreter Discovery', async function ({ sessions }) {
		await expectSessionStartToFail(sessions, 'python', buildPythonPath('override'));
	});
});
