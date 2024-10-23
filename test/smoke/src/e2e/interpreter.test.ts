/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './test.setup';

test.describe('Interpreter Test - Option A', () => {
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

test.describe('Interpreter Test - Option B', () => {
	test('1st test', async ({ rInterpreter }) => {
		console.log('  test 1 > r interpret should start');
	});
	test('2nd test', async ({ rInterpreter }) => {
		console.log('  test 2 > r interpret should not restart');
	});
	test('3rd test', async ({ pythonInterpreter }) => {
		console.log('  test 3 > python interpret should start');
	});
	test('4th test', async ({ pythonInterpreter }) => {
		console.log('  test 4 > python interpret should not restart');
	});
	test('5th test', async ({ rInterpreter }) => {
		console.log('  test 5 > r interpret should start');
	});
});
