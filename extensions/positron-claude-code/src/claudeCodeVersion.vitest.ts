/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { chatTakesPrompt } from './claudeCodeVersion';

describe('chatTakesPrompt', () => {
	it('accepts the first version whose chat takes a prompt, and rejects older ones', () => {
		expect(['2.1.303', '2.0.35', '2.0.35-beta.1', '2.0.34', '1.0.126', ''].map(chatTakesPrompt))
			.toEqual([true, true, true, false, false, false]);
	});
});
