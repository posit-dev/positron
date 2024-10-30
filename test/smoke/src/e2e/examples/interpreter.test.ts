/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';

// By default, no interpreter is set. The recommendation is to set the interpreter for EACH test.
// If you the intended interpreter is already set, the interpreter will not restart/switch.
// If the intended interpreter is not set, the interpreter will start/switch.

test.describe('Interpreter Test', () => {
	test('1st test - r interpreter should start', { tag: ['@web'] }, async ({ interpreter }) => {
		await interpreter.set('R');
	});

	test('2nd test - r interpreter should NOT start', async ({ interpreter }) => {
		await interpreter.set('R');
	});

	test('3rd test - python interpreter should start', async ({ interpreter }) => {
		await interpreter.set('Python');
	});

	test('4th test - python interpreter should NOT start', async ({ interpreter }) => {
		await interpreter.set('Python');
	});

	test('5th test - r interpreter should start', async ({ interpreter }) => {
		await interpreter.set('R');
	});
});
