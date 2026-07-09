/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { POSIT_NEW_CHAT_COMMAND, NewChatOptions } from '../../../positronAssistant/browser/positAssistantChat.js';
import { QuartoOutputQuickFix } from '../../browser/QuartoOutputQuickFix.js';
import { QuartoCellErrorContext } from '../../common/quartoExecutionTypes.js';

describe('QuartoOutputQuickFix', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand: vi.fn().mockResolvedValue(undefined) })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function setGates(aiEnabled: boolean | undefined, hasChatModels: boolean | undefined) {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		const contextKeyService = ctx.get(IContextKeyService) as MockContextKeyService;
		if (aiEnabled !== undefined) {
			configurationService.setUserConfiguration('ai.enabled', aiEnabled);
		}
		if (hasChatModels !== undefined) {
			contextKeyService.createKey('posit-assistant.hasChatModels', hasChatModels);
		}
	}

	function renderQuickFix(cellContext?: QuartoCellErrorContext) {
		return rtl.render(
			<QuartoOutputQuickFix
				cellContext={cellContext}
				errorContent='NameError: name "x" is not defined'
			/>
		);
	}

	function lastNewChatOptions(): NewChatOptions {
		const executeCommand = vi.mocked(ctx.get(ICommandService).executeCommand);
		const lastCall = executeCommand.mock.calls.at(-1);
		expect(lastCall?.[0]).toBe(POSIT_NEW_CHAT_COMMAND);
		return lastCall?.[1] as NewChatOptions;
	}

	function decodeAttachment(uri: string): string {
		return decodeBase64(uri.replace('data:text/plain;base64,', '')).toString();
	}

	it('renders Fix/Explain buttons when AI is enabled and chat models are available', () => {
		setGates(true, true);
		renderQuickFix();
		expect(screen.getByRole('group', { name: /quick fix/i })).toBeInTheDocument();
	});

	it('renders the buttons when ai.enabled is unset (defaults to enabled)', () => {
		setGates(undefined, true);
		renderQuickFix();
		expect(screen.getByRole('group', { name: /quick fix/i })).toBeInTheDocument();
	});

	it('does not render the buttons when AI features are disabled', () => {
		setGates(false, true);
		renderQuickFix();
		expect(screen.queryByRole('group', { name: /quick fix/i })).not.toBeInTheDocument();
	});

	it('does not render the buttons when no chat models are available', () => {
		setGates(true, false);
		renderQuickFix();
		expect(screen.queryByRole('group', { name: /quick fix/i })).not.toBeInTheDocument();
	});

	describe('payload with cell context', () => {
		const cellContext: QuartoCellErrorContext = {
			path: 'report.qmd',
			language: 'python',
			label: 'setup',
			code: 'raise RuntimeError("boom")',
			codeStartLine: 8,
			codeEndLine: 8,
		};

		it('sends the failing code and its location alongside the error', async () => {
			const user = userEvent.setup();
			setGates(true, true);
			renderQuickFix(cellContext);
			await user.click(screen.getByRole('button', { name: 'Ask assistant to fix in new chat' }));

			const options = lastNewChatOptions();
			expect({
				prompt: options.prompt,
				attachment: options.files && decodeAttachment(options.files[0].uri),
			}).toEqual({
				prompt: 'Fix the error from the python code chunk at lines 8-8 of report.qmd. The failing code and its error output are attached; fix only this error.',
				attachment: [
					'Error from the python code chunk in report.qmd, lines 8-8 (label: setup):',
					'',
					'--- Failing code ---',
					'raise RuntimeError("boom")',
					'',
					'--- Error output ---',
					'NameError: name "x" is not defined',
				].join('\n'),
			});
		});

		it('keeps the explain-only constraint on the contextual explain prompt', async () => {
			const user = userEvent.setup();
			setGates(true, true);
			renderQuickFix(cellContext);
			await user.click(screen.getByRole('button', { name: 'Ask assistant to explain in new chat' }));

			expect(lastNewChatOptions().prompt).toBe(
				'Explain the error from the python code chunk at lines 8-8 of report.qmd. The failing code and its error output are attached. Do not make changes or edit any files; just explain the error.'
			);
		});

		it('falls back to the error-only payload when no cell context is provided', async () => {
			const user = userEvent.setup();
			setGates(true, true);
			renderQuickFix(undefined);
			await user.click(screen.getByRole('button', { name: 'Ask assistant to fix in new chat' }));

			const options = lastNewChatOptions();
			expect({
				prompt: options.prompt,
				attachment: options.files && decodeAttachment(options.files[0].uri),
			}).toEqual({
				prompt: 'Fix this Quarto inline output error.',
				attachment: 'NameError: name "x" is not defined',
			});
		});
	});
});
