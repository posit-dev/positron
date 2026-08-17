/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import {
	POSITRON_QUARTO_INLINE_OUTPUT_KEY,
	QUARTO_INLINE_OUTPUT_AUTO_SCROLL_KEY,
	QUARTO_INLINE_OUTPUT_ENABLED_KEY,
	QUARTO_NATIVE_LANGUAGE_FEATURES_KEY,
	getQuartoConfigValue,
	usingNativeEmbeddedFeatures,
	usingQuartoInlineOutputAutoScroll,
} from '../../common/positronQuartoConfig.js';

describe('getQuartoConfigValue', () => {
	it('prefers the new key, falls back to the deprecated alias, then the default', async () => {
		const newKey = QUARTO_INLINE_OUTPUT_ENABLED_KEY;
		const oldKey = POSITRON_QUARTO_INLINE_OUTPUT_KEY;

		const neither = new TestConfigurationService();

		const oldOnly = new TestConfigurationService();
		await oldOnly.setUserConfiguration(oldKey, true);

		const newOnly = new TestConfigurationService();
		await newOnly.setUserConfiguration(newKey, true);

		// New key wins even when it disagrees with the deprecated alias.
		const both = new TestConfigurationService();
		await both.setUserConfiguration(newKey, false);
		await both.setUserConfiguration(oldKey, true);

		expect({
			neither: getQuartoConfigValue(neither, newKey, oldKey, false),
			oldOnly: getQuartoConfigValue(oldOnly, newKey, oldKey, false),
			newOnly: getQuartoConfigValue(newOnly, newKey, oldKey, false),
			both: getQuartoConfigValue(both, newKey, oldKey, true),
		}).toEqual({
			neither: false,
			oldOnly: true,
			newOnly: true,
			both: false,
		});
	});
});

describe('usingQuartoInlineOutputAutoScroll', () => {
	it('defaults on and is only off when explicitly set to false', async () => {
		const unset = new TestConfigurationService();

		const off = new TestConfigurationService();
		await off.setUserConfiguration(QUARTO_INLINE_OUTPUT_AUTO_SCROLL_KEY, false);

		const on = new TestConfigurationService();
		await on.setUserConfiguration(QUARTO_INLINE_OUTPUT_AUTO_SCROLL_KEY, true);

		expect({
			unset: usingQuartoInlineOutputAutoScroll(unset),
			off: usingQuartoInlineOutputAutoScroll(off),
			on: usingQuartoInlineOutputAutoScroll(on),
		}).toEqual({
			unset: true,
			off: false,
			on: true,
		});
	});
});

describe('usingNativeEmbeddedFeatures', () => {
	it('defaults off and is only on when explicitly set to true', async () => {
		const unset = new TestConfigurationService();

		const off = new TestConfigurationService();
		await off.setUserConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY, false);

		const on = new TestConfigurationService();
		await on.setUserConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY, true);

		expect({
			unset: usingNativeEmbeddedFeatures(unset),
			off: usingNativeEmbeddedFeatures(off),
			on: usingNativeEmbeddedFeatures(on),
		}).toEqual({
			unset: false,
			off: false,
			on: true,
		});
	});
});
