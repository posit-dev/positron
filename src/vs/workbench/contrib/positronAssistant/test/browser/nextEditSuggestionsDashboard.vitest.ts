/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { isNextEditSuggestionsEnabled, NES_ENABLE_SETTING, setNextEditSuggestionsEnabled } from '../../browser/nextEditSuggestionsDashboard.js';

describe('nextEditSuggestions enablement helpers', () => {
	function configWith(enable?: Record<string, boolean>): TestConfigurationService {
		const config = new TestConfigurationService();
		if (enable) {
			config.setUserConfiguration(NES_ENABLE_SETTING, enable);
		}
		return config;
	}

	describe('isNextEditSuggestionsEnabled', () => {
		it('returns true when the setting is unset', () => {
			expect(isNextEditSuggestionsEnabled(configWith(), 'python')).toBe(true);
		});

		it('prefers a language-specific entry over the wildcard', () => {
			const config = configWith({ '*': true, markdown: false });
			expect(isNextEditSuggestionsEnabled(config, 'markdown')).toBe(false);
		});

		it('falls back to the wildcard when the language is not listed', () => {
			const config = configWith({ '*': false, python: true });
			expect(isNextEditSuggestionsEnabled(config, 'ruby')).toBe(false);
		});

		it('returns the wildcard value when no language is given', () => {
			expect(isNextEditSuggestionsEnabled(configWith({ '*': false }))).toBe(false);
		});

		it('defaults to true when neither the language nor the wildcard is present', () => {
			expect(isNextEditSuggestionsEnabled(configWith({ python: true }), 'ruby')).toBe(true);
		});
	});

	describe('setNextEditSuggestionsEnabled', () => {
		it('merges the new key into the existing object', async () => {
			const config = configWith({ '*': true, markdown: false });
			const spy = vi.spyOn(config, 'updateValue');

			await setNextEditSuggestionsEnabled(config, 'python', false);

			expect(spy).toHaveBeenCalledWith(NES_ENABLE_SETTING, { '*': true, markdown: false, python: false });
		});

		it('writes a fresh object when the setting is unset', async () => {
			const config = configWith();
			const spy = vi.spyOn(config, 'updateValue');

			await setNextEditSuggestionsEnabled(config, '*', false);

			expect(spy).toHaveBeenCalledWith(NES_ENABLE_SETTING, { '*': false });
		});
	});
});
