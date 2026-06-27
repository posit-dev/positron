/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ChatEntitlementContext, ChatEntitlementContextKeys } from '../../common/chatEntitlementService.js';

// `ai.enabled` is Positron's main AI switch. When it's off, the chat UI (the
// chat pane and the Copilot status icon) must hide just like Copilot's own
// `chat.disableAIFeatures`. Both feed the `chatSetupHidden` context key through
// `ChatEntitlementContext`, so these tests assert that key flips with
// `ai.enabled` -- including at runtime, without a reload.
describe('ChatEntitlementContext ai.enabled gating', () => {
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

	it('hides the chat UI when ai.enabled is off at startup', () => {
		configurationService.setUserConfiguration('ai.enabled', false);
		createContext();

		expect(isHidden()).toBe(true);
	});

	it('leaves the chat UI visible when ai.enabled is unset and Copilot is not disabled', () => {
		createContext();

		expect(isHidden()).toBe(false);
	});

	it('flips chatSetupHidden when ai.enabled toggles at runtime, no reload', async () => {
		createContext();
		expect(isHidden()).toBe(false);

		// The config listener recomputes via the async `updateContext()`, so let
		// its microtask settle before asserting.
		configurationService.setUserConfiguration('ai.enabled', false);
		fireConfigChange('ai.enabled');
		await Promise.resolve();
		expect(isHidden()).toBe(true);

		configurationService.setUserConfiguration('ai.enabled', true);
		fireConfigChange('ai.enabled');
		await Promise.resolve();
		expect(isHidden()).toBe(false);
	});
});
