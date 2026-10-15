/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IContextMenuDelegate } from '../../../../../base/browser/contextmenu.js';
import { IAction } from '../../../../../base/common/actions.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { POSIT_NEW_CHAT_COMMAND, NewChatOptions } from '../../../positronAssistant/browser/positAssistantChat.js';
import { QuartoOutputQuickFix } from '../../browser/QuartoOutputQuickFix.js';
import { QuartoCellErrorContext } from '../../common/quartoExecutionTypes.js';
import { registerPositAssistantErrorActions } from '../../../positronAssistant/test/browser/positAssistantErrorActionsTestUtils.js';

describe('QuartoOutputQuickFix', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand: vi.fn().mockResolvedValue(undefined) })
		.stub(IContextMenuService, { showContextMenu: vi.fn() })
		.stub(INotificationService, { error: vi.fn() })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	/** A real context key service, so key changes re-render the quick fix. */
	let contextKeyService: ContextKeyService;

	beforeEach(() => {
		// Send errors to Posit Assistant, as the workbench does.
		contextKeyService = registerPositAssistantErrorActions(ctx);
	});

	function setGates(aiEnabled: boolean | undefined, hasChatModels: boolean | undefined) {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		if (aiEnabled !== undefined) {
			configurationService.setUserConfiguration('ai.enabled', aiEnabled);
		}
		if (hasChatModels !== undefined) {
			contextKeyService.createKey('posit-assistant.hasChatModels', hasChatModels);
		}
	}

	function renderQuickFix(cellContext?: QuartoCellErrorContext, errorContent = 'NameError: name "x" is not defined') {
		return rtl.render(
			<QuartoOutputQuickFix
				cellContext={cellContext}
				errorContent={errorContent}
			/>
		);
	}

	/** Run the first action in the dropdown opened by the given button. */
	async function runDropdownAction(user: ReturnType<typeof userEvent.setup>, buttonName: string) {
		await user.click(screen.getByRole('button', { name: buttonName }));
		const showContextMenu = vi.mocked(ctx.get(IContextMenuService).showContextMenu);
		const delegate = showContextMenu.mock.calls.at(-1)?.[0] as IContextMenuDelegate;
		await (delegate.getActions() as IAction[])[0].run();
	}

	/** The newChat options from the most recent call, with attachments decoded. */
	function lastDecodedNewChatOptions() {
		const options = lastNewChatOptions();
		return {
			...options,
			files: options.files?.map(file => ({ name: file.name, content: decodeAttachment(file.uri) })),
		};
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
			await user.click(screen.getByRole('button', { name: 'Ask Posit Assistant to fix in new chat' }));

			const options = lastNewChatOptions();
			expect({
				prompt: options.prompt,
				name: options.files?.[0].name,
				attachment: options.files && decodeAttachment(options.files[0].uri),
			}).toEqual({
				prompt: 'Fix the error from the python code chunk at lines 8-8 of report.qmd. The failing code and its error output are attached; fix only this error.',
				name: 'Quarto Output Error',
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
			await user.click(screen.getByRole('button', { name: 'Ask Posit Assistant to explain in new chat' }));

			expect(lastNewChatOptions().prompt).toBe(
				'Explain the error from the python code chunk at lines 8-8 of report.qmd. The failing code and its error output are attached. Do not make changes or edit any files; just explain the error.'
			);
		});

		it('falls back to the error-only payload when no cell context is provided', async () => {
			const user = userEvent.setup();
			setGates(true, true);
			renderQuickFix(undefined);
			await user.click(screen.getByRole('button', { name: 'Ask Posit Assistant to fix in new chat' }));

			const options = lastNewChatOptions();
			expect({
				prompt: options.prompt,
				name: options.files?.[0].name,
				attachment: options.files && decodeAttachment(options.files[0].uri),
			}).toEqual({
				prompt: 'Fix this Quarto inline output error.',
				name: 'Quarto Output Error',
				attachment: 'NameError: name "x" is not defined',
			});
		});
	});

	it('sends Explain without chunk context to a new chat with the explain-only constraint', async () => {
		const user = userEvent.setup();
		setGates(true, true);
		renderQuickFix(undefined);
		await user.click(screen.getByRole('button', { name: 'Ask Posit Assistant to explain in new chat' }));

		expect(lastDecodedNewChatOptions()).toEqual({
			prompt: 'Explain this Quarto inline output error. Do not make changes or edit any files; just explain the error.',
			target: 'new',
			behavior: 'submit',
			files: [{ name: 'Quarto Output Error', content: 'NameError: name "x" is not defined' }],
		});
	});

	it('continues the current chat from the Fix dropdown', async () => {
		const user = userEvent.setup();
		setGates(true, true);
		renderQuickFix(undefined);
		await runDropdownAction(user, 'More fix options');

		expect(lastDecodedNewChatOptions()).toEqual({
			prompt: 'Fix this Quarto inline output error.',
			target: 'auto',
			behavior: 'submit',
			files: [{ name: 'Quarto Output Error', content: 'NameError: name "x" is not defined' }],
		});
	});

	it('continues the current chat from the Explain dropdown', async () => {
		const user = userEvent.setup();
		setGates(true, true);
		renderQuickFix(undefined);
		await runDropdownAction(user, 'More explain options');

		expect(lastDecodedNewChatOptions()).toEqual({
			prompt: 'Explain this Quarto inline output error. Do not make changes or edit any files; just explain the error.',
			target: 'auto',
			behavior: 'submit',
			files: [{ name: 'Quarto Output Error', content: 'NameError: name "x" is not defined' }],
		});
	});

	it('strips ANSI escape codes and surrounding whitespace from the whole attachment', async () => {
		const user = userEvent.setup();
		setGates(true, true);
		renderQuickFix({
			path: 'report.qmd',
			language: 'python',
			code: 'raise ValueError("boom")',
			codeStartLine: 3,
			codeEndLine: 3,
		}, '\u001b[31mValueError\u001b[0m: boom\n\n');
		await user.click(screen.getByRole('button', { name: 'Ask Posit Assistant to fix in new chat' }));

		expect(lastDecodedNewChatOptions().files).toEqual([{
			name: 'Quarto Output Error',
			content: [
				'Error from the python code chunk in report.qmd, lines 3-3:',
				'',
				'--- Failing code ---',
				'raise ValueError("boom")',
				'',
				'--- Error output ---',
				'ValueError: boom',
			].join('\n'),
		}]);
	});

	it('notifies the user when Posit Assistant cannot be opened', async () => {
		vi.mocked(ctx.get(ICommandService).executeCommand).mockRejectedValueOnce(new Error('command not found'));
		const user = userEvent.setup();
		setGates(true, true);
		renderQuickFix(undefined);
		await user.click(screen.getByRole('button', { name: 'Ask Posit Assistant to fix in new chat' }));

		const notifyError = vi.mocked(ctx.get(INotificationService).error);
		await waitFor(() => expect(notifyError).toHaveBeenCalledWith('Posit Assistant could not be opened: command not found'));
	});

	it('shows and hides the buttons as Posit Assistant gains and loses chat models', () => {
		setGates(true, false);
		renderQuickFix();
		expect(screen.queryByRole('group', { name: /quick fix/i })).not.toBeInTheDocument();

		const hasChatModels = contextKeyService.createKey<boolean>('posit-assistant.hasChatModels', false);
		act(() => hasChatModels.set(true));
		expect(screen.getByRole('group', { name: /quick fix/i })).toBeInTheDocument();

		act(() => hasChatModels.set(false));
		expect(screen.queryByRole('group', { name: /quick fix/i })).not.toBeInTheDocument();
	});
});
