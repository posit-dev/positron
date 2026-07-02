/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { AI_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfiguration.js';
import { NOTEBOOK_AI_ENABLED_KEY } from '../../common/positronNotebookConfig.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { bindNotebookAIEnabledContextKey } from '../../browser/notebookAIEnabledContextKey.js';

/**
 * The composite gate is the single source of truth for notebook AI: the context
 * key is on only when the global `ai.enabled` AND the notebooks-only
 * `notebook.ai.enabled` are both on. Both settings default to true, so an unset
 * value reads as enabled and only an explicit `false` disables. This is the one
 * place the cascade is computed; every feature reads the resulting key.
 */
describe('bindNotebookAIEnabledContextKey', () => {
	beforeEach(() => ensureNoLeakedDisposables());

	// Bind the context key against a config with the given values (undefined =
	// unset) and return what the gate resolves to immediately after binding.
	function gate(aiEnabled: boolean | undefined, notebookAiEnabled: boolean | undefined): boolean | undefined {
		const config = new TestConfigurationService();
		if (aiEnabled !== undefined) {
			config.setUserConfiguration(AI_ENABLED_KEY, aiEnabled);
		}
		if (notebookAiEnabled !== undefined) {
			config.setUserConfiguration(NOTEBOOK_AI_ENABLED_KEY, notebookAiEnabled);
		}
		const contextKeyService = new MockContextKeyService();
		const binding = bindNotebookAIEnabledContextKey(contextKeyService, config);
		const value = NotebookContextKeys.aiEnabled.getValue(contextKeyService);
		binding.dispose();
		return value;
	}

	it('is enabled only when both switches allow it, with unset reading as enabled', () => {
		expect({
			bothUnset: gate(undefined, undefined),
			bothOn: gate(true, true),
			notebookUnsetGlobalOn: gate(true, undefined),
			notebookOffGlobalOn: gate(true, false),
			globalOffNotebookOn: gate(false, true),
			globalOffNotebookUnset: gate(false, undefined),
		}).toMatchInlineSnapshot(`
			{
			  "bothOn": true,
			  "bothUnset": true,
			  "globalOffNotebookOn": false,
			  "globalOffNotebookUnset": false,
			  "notebookOffGlobalOn": false,
			  "notebookUnsetGlobalOn": true,
			}
		`);
	});
});
