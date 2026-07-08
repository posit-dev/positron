/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';

// Positron hides the Copilot chat UI via `chat.disableAIFeatures` but keeps inline
// completions working. Completions are gated only by their own setting
// (`github.copilot.enable`), never by `chat.disableAIFeatures`. These tests guard
// that independence. The product module is mocked so `completionsEnablementSetting`
// resolves in the test environment (the real product.json isn't loaded under vitest).
const { completionsSetting } = vi.hoisted(() => ({ completionsSetting: 'github.copilot.enable' }));
vi.mock('../../../../platform/product/common/product.js', async (importOriginal) => {
	// Keep the rest of the product config (other modules read it at load time) and
	// only ensure `completionsEnablementSetting` resolves under vitest.
	const actual = await importOriginal<typeof import('../../../../platform/product/common/product.js')>();
	return {
		default: { ...actual.default, defaultChatAgent: { ...actual.default.defaultChatAgent, completionsEnablementSetting: completionsSetting } }
	};
});

const { isCompletionsEnabled } = await import('../../../common/services/completionsEnablement.js');

describe('completions enablement is independent of chat.disableAIFeatures', () => {
	for (const completionsOn of [true, false]) {
		it(`tracks github.copilot.enable (${completionsOn}) regardless of chat.disableAIFeatures`, () => {
			const configurationService = new TestConfigurationService();
			configurationService.setUserConfiguration(completionsSetting, { '*': completionsOn });

			configurationService.setUserConfiguration('chat.disableAIFeatures', false);
			const withChatEnabled = isCompletionsEnabled(configurationService);

			configurationService.setUserConfiguration('chat.disableAIFeatures', true);
			const withChatDisabled = isCompletionsEnabled(configurationService);

			// Same as the completions setting in both chat states.
			expect([withChatEnabled, withChatDisabled]).toEqual([completionsOn, completionsOn]);
		});
	}
});

// The `ai.enabled` main switch has higher precedence than `github.copilot.enable`:
// when it's off, completions are off even if the completions setting is on.
describe('completions enablement respects the ai.enabled main switch', () => {
	it('is off when ai.enabled is false, even with github.copilot.enable on', () => {
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(completionsSetting, { '*': true });
		configurationService.setUserConfiguration('ai.enabled', false);

		expect(isCompletionsEnabled(configurationService)).toBe(false);
	});

	it('follows github.copilot.enable when ai.enabled is unset or true', () => {
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(completionsSetting, { '*': true });

		const whenUnset = isCompletionsEnabled(configurationService);
		configurationService.setUserConfiguration('ai.enabled', true);
		const whenOn = isCompletionsEnabled(configurationService);

		expect([whenUnset, whenOn]).toEqual([true, true]);
	});
});

// The GitHub Copilot provider enable setting disables completions when off:
// turning off the Copilot provider stops completions (the provider isn't
// registered), and the status bar / areCompletionsEnabled must agree.
describe('completions enablement respects the Copilot provider setting', () => {
	const providerSetting = 'positron.assistant.provider.githubCopilot.enable';

	it('is off when the Copilot provider is disabled, even with github.copilot.enable on', () => {
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(completionsSetting, { '*': true });
		configurationService.setUserConfiguration(providerSetting, false);

		expect(isCompletionsEnabled(configurationService)).toBe(false);
	});

	it('follows github.copilot.enable when the Copilot provider is unset or enabled', () => {
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(completionsSetting, { '*': true });

		const whenUnset = isCompletionsEnabled(configurationService);
		configurationService.setUserConfiguration(providerSetting, true);
		const whenOn = isCompletionsEnabled(configurationService);

		expect([whenUnset, whenOn]).toEqual([true, true]);
	});
});
