/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';

// By default, no interpreter is set. The recommendation is to set the interpreter for EACH test.
// If you the intended interpreter is already set, the interpreter will not restart/switch.
// If the intended interpreter is not set, the interpreter will start/switch.

test.describe('Interpreter Test', () => {
	test('1st test', async ({ interpreter }) => {
		await interpreter.set('R');
		console.log('  test 1 > r interpret should start');
	});

	test('2nd test', async ({ interpreter }) => {
		await interpreter.set('R');
		console.log('  test 2 > r interpret should not restart');
	});

	test('3rd test', async ({ interpreter }) => {
		await interpreter.set('Python');
		console.log('  test 3 > python interpret should start');
	});

	test('4th test', async ({ interpreter }) => {
		await interpreter.set('Python');
		console.log('  test 4 > python interpret should not restart');
	});

	test('5th test', async ({ interpreter }) => {
		await interpreter.set('R');
		console.log('  test 5 > r interpret should start');
	});
});
