/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// SPIKE (#14695): verifies the PoC EditorInput opts into the upstream modal editor part.

import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { EditorInputCapabilities } from '../../../../common/editor.js';
import { isModalEditorOptionsProvider } from '../../../../../platform/editor/common/editor.js';
import { ConfigureProvidersEditorInput } from '../../browser/providerEditorSpike/configureProvidersEditorInput.js';

describe('ConfigureProvidersEditorInput (spike #14695)', () => {
	beforeEach(() => {
		ensureNoLeakedDisposables();
	});

	it('requires the modal editor part', () => {
		const input = new ConfigureProvidersEditorInput();
		try {
			expect(input.capabilities & EditorInputCapabilities.RequiresModal).toBeTruthy();
		} finally {
			input.dispose();
		}
	});

	it('is a singleton', () => {
		const input = new ConfigureProvidersEditorInput();
		try {
			expect(input.capabilities & EditorInputCapabilities.Singleton).toBeTruthy();
		} finally {
			input.dispose();
		}
	});

	it('provides compact-header modal options (matching Agent Customizations)', () => {
		const input = new ConfigureProvidersEditorInput();
		try {
			expect(isModalEditorOptionsProvider(input)).toBe(true);
			expect(input.getModalEditorOptions()).toEqual({ compactHeader: true });
		} finally {
			input.dispose();
		}
	});

	it('matches any other instance (singleton identity)', () => {
		const a = new ConfigureProvidersEditorInput();
		const b = new ConfigureProvidersEditorInput();
		try {
			expect(a.matches(b)).toBe(true);
		} finally {
			a.dispose();
			b.dispose();
		}
	});
});
