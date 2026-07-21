/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { shouldExecuteAfterCompletenessCheck, shouldSendKernelInterrupt } from '../completenessHelpers';

suite('completenessHelpers', () => {
	suite('shouldExecuteAfterCompletenessCheck', () => {
		test('executes complete code', () => {
			assert.strictEqual(shouldExecuteAfterCompletenessCheck('complete'), true);
		});

		test('does not execute incomplete code', () => {
			assert.strictEqual(shouldExecuteAfterCompletenessCheck('incomplete'), false);
		});

		test('executes invalid code (so the interpreter surfaces the error)', () => {
			assert.strictEqual(shouldExecuteAfterCompletenessCheck('invalid'), true);
		});

		test('executes unknown code (so the interpreter surfaces any error)', () => {
			assert.strictEqual(shouldExecuteAfterCompletenessCheck('unknown'), true);
		});
	});

	suite('shouldSendKernelInterrupt', () => {
		test('sends the interrupt when there are no pending checks (normal interrupt)', () => {
			assert.strictEqual(shouldSendKernelInterrupt(true, 0), true);
			assert.strictEqual(shouldSendKernelInterrupt(false, 0), true);
		});

		test('sends the interrupt when there are pending checks and the kernel is busy', () => {
			assert.strictEqual(shouldSendKernelInterrupt(true, 1), true);
		});

		test('skips the interrupt when there are only pending checks to abort and the kernel is idle', () => {
			assert.strictEqual(shouldSendKernelInterrupt(false, 1), false);
			assert.strictEqual(shouldSendKernelInterrupt(false, 3), false);
		});
	});
});
