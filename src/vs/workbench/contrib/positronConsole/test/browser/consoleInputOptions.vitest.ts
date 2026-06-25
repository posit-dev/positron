/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILanguageRuntimeSessionState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronConsoleInstance, PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { createConsoleInputEditorOptions, createConsoleInputLineNumbersOptions } from '../../browser/components/consoleInputOptions.js';

/**
 * Builds a console instance stub with the given state and (optionally) an
 * attached session whose prompts are `> ` / `+ `.
 */
function consoleInstance(state: PositronConsoleState, attached: boolean): IPositronConsoleInstance {
	const dynState: ILanguageRuntimeSessionState = {
		inputPrompt: '> ',
		continuationPrompt: '+ ',
		currentWorkingDirectory: '',
		busy: false,
		sessionName: 'test'
	};
	const session = attached
		? stubInterface<ILanguageRuntimeSession>({ dynState })
		: undefined;
	return stubInterface<IPositronConsoleInstance>({ state, attachedRuntimeSession: session });
}

describe('consoleInputOptions', () => {
	describe('createConsoleInputEditorOptions', () => {
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration('editor', { fontSize: 14, lineNumbers: 'on' });
		configurationService.setUserConfiguration('console', { fontFamily: 'monospace' });

		it('omits line number options even when editor.lineNumbers is configured', () => {
			const keys = Object.keys(createConsoleInputEditorOptions(configurationService));
			expect(keys).not.toContain('lineNumbers');
			expect(keys).not.toContain('lineNumbersMinChars');
		});

		it('overlays the console font options and forces the console-specific overrides', () => {
			const options = createConsoleInputEditorOptions(configurationService);
			expect({
				fontSize: options.fontSize,
				fontFamily: options.fontFamily,
				readOnly: options.readOnly,
				wordWrap: options.wordWrap
			}).toMatchInlineSnapshot(`
				{
				  "fontFamily": "monospace",
				  "fontSize": 14,
				  "readOnly": false,
				  "wordWrap": "bounded",
				}
			`);
		});
	});

	describe('createConsoleInputLineNumbersOptions', () => {
		it('hides the prompt when there is no attached session', () => {
			const { lineNumbers, lineNumbersMinChars } =
				createConsoleInputLineNumbersOptions(consoleInstance(PositronConsoleState.Ready, false));
			expect((lineNumbers as (n: number) => string)(1)).toBe('');
			expect(lineNumbersMinChars).toBe(0);
		});

		it('shows the input/continuation prompt in prompt-bearing states', () => {
			for (const state of [PositronConsoleState.Uninitialized, PositronConsoleState.Starting, PositronConsoleState.Ready]) {
				const { lineNumbers } =
					createConsoleInputLineNumbersOptions(consoleInstance(state, true));
				const prompt = lineNumbers as (n: number) => string;
				expect([prompt(1), prompt(2)]).toStrictEqual(['> ', '+ ']);
			}
		});

		it('hides the prompt in non-prompt states such as Busy', () => {
			for (const state of [PositronConsoleState.Busy, PositronConsoleState.Offline, PositronConsoleState.Exiting, PositronConsoleState.Exited, PositronConsoleState.Disconnected]) {
				const { lineNumbers } =
					createConsoleInputLineNumbersOptions(consoleInstance(state, true));
				const prompt = lineNumbers as (n: number) => string;
				expect([prompt(1), prompt(2)]).toStrictEqual(['', '']);
			}
		});
	});
});
