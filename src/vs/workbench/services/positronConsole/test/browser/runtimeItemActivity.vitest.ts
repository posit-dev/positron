/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ActivityItemInput, ActivityItemInputState } from '../../browser/classes/activityItemInput.js';
import { ActivityItemOutputMessage } from '../../browser/classes/activityItemOutputMessage.js';
import { RuntimeItemActivity } from '../../browser/classes/runtimeItemActivity.js';

const when = new Date(0);

function createInput(id: string, state: ActivityItemInputState, code: string) {
	return new ActivityItemInput(id, 'parent', when, state, '>>> ', '... ', code);
}

describe('RuntimeItemActivity.input', () => {
	it('is undefined when the activity has no input', () => {
		const activity = new RuntimeItemActivity('parent', new ActivityItemOutputMessage('output', 'parent', when, { 'text/plain': '1' }));
		expect(activity.input).toBeUndefined();
	});

	it('is the input that started the activity', () => {
		const input = createInput('input', ActivityItemInputState.Executing, 'print(x)');
		const activity = new RuntimeItemActivity('parent', input);
		activity.addActivityItem(new ActivityItemOutputMessage('output', 'parent', when, { 'text/plain': '1' }));
		expect(activity.input).toBe(input);
	});

	it('is the real input once it replaces a provisional one', () => {
		const activity = new RuntimeItemActivity('parent', createInput('provisional', ActivityItemInputState.Provisional, 'print(x)'));
		const input = createInput('input', ActivityItemInputState.Executing, 'print(x)');
		activity.addActivityItem(input);
		expect(activity.input).toBe(input);
	});
});
