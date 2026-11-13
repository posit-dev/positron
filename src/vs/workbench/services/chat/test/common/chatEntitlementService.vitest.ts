/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ChatEntitlementContext, ChatEntitlementContextKeys, IChatSentiment, isCompletionsOnlyMode } from '../../common/chatEntitlementService.js';

// Positron doesn't ship the default chat extension (GitHub Copilot Chat), so
// `ChatEntitlementContext` always reports chat setup as hidden. That keeps
// upstream's setup agents from registering and hides the chat view's setup
// fallback, which would otherwise show an empty chat view to anyone with
// `chat.disableAIFeatures: false` (see `withConfiguration`).
describe('ChatEntitlementContext setup hiding', () => {
	const disposables = ensureNoLeakedDisposables();

	let contextKeyService: MockContextKeyService;
	let configurationService: TestConfigurationService;

	beforeEach(() => {
		contextKeyService = new MockContextKeyService();
		configurationService = new TestConfigurationService();
	});

	const createContext = () => disposables.add(new ChatEntitlementContext(
		contextKeyService,
		disposables.add(new InMemoryStorageService()),
		new NullLogService(),
		configurationService,
		NullTelemetryService,
	));

	const isHidden = () => ChatEntitlementContextKeys.Setup.hidden.getValue(contextKeyService) === true;

	const fireConfigChange = (changedKey: string) => {
		configurationService.onDidChangeConfigurationEmitter.fire({
			affectsConfiguration: (key: string) => key === changedKey,
			affectedKeys: new Set([changedKey]),
			change: { keys: [], overrides: [] },
			source: ConfigurationTarget.USER,
		});
	};

	const cases = [
		{ name: 'no settings', config: {} },
		{ name: 'chat opted in and AI on', config: { 'chat.disableAIFeatures': false, 'ai.enabled': true } },
		{ name: 'chat hidden', config: { 'chat.disableAIFeatures': true } },
		{ name: 'AI off', config: { 'ai.enabled': false } },
	];
	for (const { name, config } of cases) {
		it(`hides chat setup with ${name}`, () => {
			for (const [key, value] of Object.entries(config)) {
				configurationService.setUserConfiguration(key, value);
			}
			createContext();

			expect(isHidden()).toBe(true);
		});
	}

	it('keeps chat setup hidden when the settings change at runtime', async () => {
		configurationService.setUserConfiguration('ai.enabled', false);
		const context = createContext();
		expect(isHidden()).toBe(true);

		// The config listener recomputes via the async `updateContext()`, so let
		// its microtask settle before asserting.
		configurationService.setUserConfiguration('ai.enabled', true);
		configurationService.setUserConfiguration('chat.disableAIFeatures', false);
		fireConfigChange('ai.enabled');
		fireConfigChange('chat.disableAIFeatures');
		await Promise.resolve();
		expect(isHidden()).toBe(true);
		expect(context.state.hidden).toBe(true);
	});

	it('keeps chat setup hidden when an installed chat extension reports itself', async () => {
		const context = createContext();

		// Upstream treats an installed, enabled default chat extension as a sign to
		// unhide chat setup. A sideloaded Copilot Chat must not bring setup back.
		await context.update({ installed: true, disabled: false, untrusted: false, disabledInWorkspace: false });
		expect(isHidden()).toBe(true);
	});
});

// Positron keeps Copilot inline completions (and their status UI) available when
// the chat UI is hidden by `chat.disableAIFeatures`, but not when the `ai.enabled`
// main switch is off. `isCompletionsOnlyMode` encodes exactly that.
describe('isCompletionsOnlyMode', () => {
	const installed: IChatSentiment = { installed: true };

	type Case = {
		name: string;
		aiEnabled?: boolean;
		chatDisabled?: boolean;
		sentiment: IChatSentiment;
		expected: boolean;
	};

	const cases: Case[] = [
		// Master switch off: everything, completions included, stays off.
		{ name: 'ai.enabled off wins over chat disabled', aiEnabled: false, chatDisabled: true, sentiment: installed, expected: false },
		// Chat hidden only by `chat.disableAIFeatures`: completions stay available.
		{ name: 'chat disabled, ai unset', chatDisabled: true, sentiment: installed, expected: true },
		{ name: 'chat disabled, ai on', aiEnabled: true, chatDisabled: true, sentiment: installed, expected: true },
		// Full Copilot UI (upstream default): the getter does not apply.
		{ name: 'chat not disabled', aiEnabled: true, chatDisabled: false, sentiment: installed, expected: false },
		{ name: 'both unset', sentiment: installed, expected: false },
		// Extension not usable, even with chat disabled.
		{ name: 'not installed', chatDisabled: true, sentiment: {}, expected: false },
		{ name: 'disabled extension', chatDisabled: true, sentiment: { installed: true, disabled: true }, expected: false },
		{ name: 'untrusted workspace', chatDisabled: true, sentiment: { installed: true, untrusted: true }, expected: false },
	];

	for (const { name, aiEnabled, chatDisabled, sentiment, expected } of cases) {
		it(name, () => {
			const configurationService = new TestConfigurationService();
			if (typeof aiEnabled === 'boolean') {
				configurationService.setUserConfiguration('ai.enabled', aiEnabled);
			}
			if (typeof chatDisabled === 'boolean') {
				configurationService.setUserConfiguration('chat.disableAIFeatures', chatDisabled);
			}

			expect(isCompletionsOnlyMode(configurationService, sentiment)).toBe(expected);
		});
	}
});
