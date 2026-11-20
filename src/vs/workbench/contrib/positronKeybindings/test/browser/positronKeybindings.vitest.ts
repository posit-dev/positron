/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { OperatingSystem } from '../../../../../base/common/platform.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContext } from '../../../../../platform/contextkey/common/contextkey.js';
import { KeybindingsRegistry } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { USLayoutResolvedKeybinding } from '../../../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { CTX_INLINE_CHAT_HAS_AGENT, CTX_INLINE_CHAT_HAS_NOTEBOOK_AGENT } from '../../../inlineChat/common/inlineChat.js';
import { NOTEBOOK_EDITOR_ID } from '../../../notebook/common/notebookCommon.js';
import { PositronKeybindingsContribution } from '../../browser/positronKeybindings.contribution.js';

const RSTUDIO_KEYBINDINGS_KEY = 'workbench.keybindings.rstudioKeybindings';
const REINDENT_COMMAND = 'editor.action.reindentselectedlines';

/** The chords bound to the reindent command, and the rule's `when` clause. */
function reindentRules() {
	return KeybindingsRegistry.getDefaultKeybindingsForOS(OperatingSystem.Linux)
		.filter(item => item.command === REINDENT_COMMAND && item.keybinding)
		.map(item => ({
			chord: USLayoutResolvedKeybinding.resolveKeybinding(item.keybinding!, OperatingSystem.Linux)[0].getDispatchChords().join(' '),
			when: item.when,
		}));
}

/** A context key lookup over a fixed set of values. */
function contextOf(values: Record<string, unknown>): IContext {
	return { getValue: <T>(key: string) => values[key] as T | undefined };
}

describe('PositronKeybindingsContribution reindent on Ctrl+I', () => {
	const configurationService = new TestConfigurationService();
	const ctx = createLightTestContainer()
		.stub(IConfigurationService, configurationService)
		.build();

	function createContribution(rstudioKeybindings: boolean) {
		configurationService.setUserConfiguration(RSTUDIO_KEYBINDINGS_KEY, rstudioKeybindings);
		ctx.disposables.add(ctx.instantiationService.createInstance(PositronKeybindingsContribution));
	}

	it('does not bind Ctrl+I to reindent without RStudio keybindings', () => {
		createContribution(false);

		expect(reindentRules()).toEqual([]);
	});

	it('binds Ctrl+I to reindent only while inline chat has no agent', () => {
		createContribution(true);

		const rules = reindentRules();
		expect(rules.map(rule => rule.chord)).toEqual(['ctrl+I']);

		// Inline chat takes Ctrl+I when an agent is registered for the editor, or
		// for a notebook while a notebook is the active editor. Positron ships no
		// inline chat agent, so reindent applies by default.
		const when = rules[0].when;
		const focused = { [EditorContextKeys.editorTextFocus.key]: true };
		expect({
			noAgent: when?.evaluate(contextOf(focused)),
			editorAgent: when?.evaluate(contextOf({ ...focused, [CTX_INLINE_CHAT_HAS_AGENT.key]: true })),
			notebookAgentInNotebook: when?.evaluate(contextOf({ ...focused, [CTX_INLINE_CHAT_HAS_NOTEBOOK_AGENT.key]: true, activeEditor: NOTEBOOK_EDITOR_ID })),
			notebookAgentElsewhere: when?.evaluate(contextOf({ ...focused, [CTX_INLINE_CHAT_HAS_NOTEBOOK_AGENT.key]: true })),
			editorNotFocused: when?.evaluate(contextOf({})),
		}).toEqual({
			noAgent: true,
			editorAgent: false,
			notebookAgentInNotebook: false,
			notebookAgentElsewhere: true,
			editorNotFocused: false,
		});
	});
});
