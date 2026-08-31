/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { providerIconId } from '../../browser/customProviderKinds.js';

describe('customProviderKinds', () => {
	it('shows a custom entry under the icon of the provider its type borrows from', () => {
		expect([
			providerIconId({ id: 'Work Anthropic', displayName: 'Work Anthropic', customKind: 'anthropic' }),
			providerIconId({ id: 'My Gateway', displayName: 'My Gateway', customKind: 'openai-compatible' }),
			// A built-in keeps its own icon.
			providerIconId({ id: 'anthropic-api', displayName: 'Anthropic' }),
			// Hand-written, of a kind Positron doesn't offer: nothing to borrow,
			// so it falls back to its own id and the generic icon.
			providerIconId({ id: 'My Local', displayName: 'My Local', customKind: 'ollama' }),
		]).toEqual(['anthropic-api', 'openai-compatible', 'anthropic-api', 'My Local']);
	});
});
