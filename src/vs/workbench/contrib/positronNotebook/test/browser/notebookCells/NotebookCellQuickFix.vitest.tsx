/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IContextMenuDelegate } from '../../../../../../base/browser/contextmenu.js';
import { IAction } from '../../../../../../base/common/actions.js';
import { decodeBase64 } from '../../../../../../base/common/buffer.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextMenuService } from '../../../../../../platform/contextview/browser/contextView.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { NewChatOptions, POSIT_HAS_CHAT_MODELS_KEY, POSIT_NEW_CHAT_COMMAND } from '../../../../positronAssistant/browser/positAssistantChat.js';
import { POSITRON_NOTEBOOK_ENABLED_KEY } from '../../../common/positronNotebookConfig.js';
import { NotebookContextKeys } from '../../../common/notebookContextKeys.js';
import { NotebookCellQuickFix } from '../../../browser/notebookCells/NotebookCellQuickFix.js';
import { registerPositAssistantErrorActions } from '../../../../positronAssistant/test/browser/positAssistantErrorActionsTestUtils.js';

describe('NotebookCellQuickFix', () => {
	const executeCommand = vi.fn();
	const notifyError = vi.fn();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.stub(IContextMenuService, { showContextMenu: vi.fn() })
		.stub(INotificationService, { error: notifyError })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	/** A real context key service, so key changes re-render the quick fix. */
	let contextKeyService: ContextKeyService;

	beforeEach(() => {
		executeCommand.mockReset().mockResolvedValue(undefined);
		notifyError.mockReset();
		// Send errors to Posit Assistant, as the workbench does.
		contextKeyService = registerPositAssistantErrorActions(ctx);
	});

	/** Set the quick fix's gates; each defaults to showing the buttons. */
	function setGates(gates: { notebookEnabled?: boolean; notebookAiEnabled?: boolean; hasChatModels?: boolean } = {}) {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration(POSITRON_NOTEBOOK_ENABLED_KEY, gates.notebookEnabled ?? true);
		if (gates.notebookAiEnabled !== undefined) {
			contextKeyService.createKey(NotebookContextKeys.aiEnabled.key, gates.notebookAiEnabled);
		}
		contextKeyService.createKey(POSIT_HAS_CHAT_MODELS_KEY, gates.hasChatModels ?? true);
	}

	function renderQuickFix(errorContent = 'NameError: name "x" is not defined') {
		return rtl.render(<NotebookCellQuickFix errorContent={errorContent} />);
	}

	/** The newChat options from the most recent call, with attachments decoded. */
	function lastNewChatOptions() {
		const lastCall = executeCommand.mock.calls.at(-1);
		expect(lastCall?.[0]).toBe(POSIT_NEW_CHAT_COMMAND);
		const options = lastCall?.[1] as NewChatOptions;
		return {
			...options,
			files: options.files?.map(file => ({ name: file.name, content: decodeBase64(file.uri.replace('data:text/plain;base64,', '')).toString() })),
		};
	}

	/** Run the first action in the dropdown opened by the given button. */
	async function runDropdownAction(user: ReturnType<typeof userEvent.setup>, buttonName: string) {
		await user.click(screen.getByRole('button', { name: buttonName }));
		const showContextMenu = vi.mocked(ctx.get(IContextMenuService).showContextMenu);
		const delegate = showContextMenu.mock.calls.at(-1)?.[0] as IContextMenuDelegate;
		await (delegate.getActions() as IAction[])[0].run();
	}

	const quickFixGroup = { name: 'Cell output quick fix actions' };

	it('sends Fix to a new Posit Assistant chat with the error attached', async () => {
		const user = userEvent.setup();
		setGates();
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'Ask assistant to fix in new chat' }));

		expect(lastNewChatOptions()).toEqual({
			prompt: 'Fix this notebook cell error.',
			target: 'new',
			behavior: 'submit',
			files: [{ name: 'Notebook Cell Error', content: 'NameError: name "x" is not defined' }],
		});
	});

	it('sends Explain to a new Posit Assistant chat with the explain-only constraint', async () => {
		const user = userEvent.setup();
		setGates();
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'Ask assistant to explain in new chat' }));

		expect(lastNewChatOptions()).toEqual({
			prompt: 'Explain this notebook cell error. Do not make changes or edit any files; just explain the error.',
			target: 'new',
			behavior: 'submit',
			files: [{ name: 'Notebook Cell Error', content: 'NameError: name "x" is not defined' }],
		});
	});

	it('continues the current chat from the Fix dropdown', async () => {
		const user = userEvent.setup();
		setGates();
		renderQuickFix();
		await runDropdownAction(user, 'More fix options');

		expect(lastNewChatOptions()).toEqual({
			prompt: 'Fix this notebook cell error.',
			target: 'auto',
			behavior: 'submit',
			files: [{ name: 'Notebook Cell Error', content: 'NameError: name "x" is not defined' }],
		});
	});

	it('continues the current chat from the Explain dropdown', async () => {
		const user = userEvent.setup();
		setGates();
		renderQuickFix();
		await runDropdownAction(user, 'More explain options');

		expect(lastNewChatOptions()).toEqual({
			prompt: 'Explain this notebook cell error. Do not make changes or edit any files; just explain the error.',
			target: 'auto',
			behavior: 'submit',
			files: [{ name: 'Notebook Cell Error', content: 'NameError: name "x" is not defined' }],
		});
	});

	it('strips ANSI escape codes and surrounding whitespace from the attachment', async () => {
		const user = userEvent.setup();
		setGates();
		renderQuickFix('\n  \u001b[31mValueError\u001b[0m: boom\n\n');
		await user.click(screen.getByRole('button', { name: 'Ask assistant to fix in new chat' }));

		expect(lastNewChatOptions().files).toEqual([{ name: 'Notebook Cell Error', content: 'ValueError: boom' }]);
	});

	it('omits the attachment when the error is blank', async () => {
		const user = userEvent.setup();
		setGates();
		renderQuickFix('  \n');
		await user.click(screen.getByRole('button', { name: 'Ask assistant to fix in new chat' }));

		expect(lastNewChatOptions().files).toBeUndefined();
	});

	it('notifies the user when Posit Assistant cannot be opened', async () => {
		executeCommand.mockRejectedValueOnce(new Error('command not found'));
		const user = userEvent.setup();
		setGates();
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'Ask assistant to fix in new chat' }));

		await waitFor(() => expect(notifyError).toHaveBeenCalledWith('Posit Assistant could not be opened: command not found'));
	});

	it('shows the buttons before the notebook AI context key is bound', () => {
		setGates();
		renderQuickFix();
		expect(screen.getByRole('group', quickFixGroup)).toBeInTheDocument();
	});

	it('hides the buttons when notebook AI is off', () => {
		setGates({ notebookAiEnabled: false });
		renderQuickFix();
		expect(screen.queryByRole('group', quickFixGroup)).not.toBeInTheDocument();
	});

	it('hides the buttons when Positron notebooks are off', () => {
		setGates({ notebookEnabled: false });
		renderQuickFix();
		expect(screen.queryByRole('group', quickFixGroup)).not.toBeInTheDocument();
	});

	it('hides the buttons when Posit Assistant has no chat models', () => {
		setGates({ hasChatModels: false });
		renderQuickFix();
		expect(screen.queryByRole('group', quickFixGroup)).not.toBeInTheDocument();
	});

	it('shows and hides the buttons as Posit Assistant gains and loses chat models', () => {
		setGates({ hasChatModels: false });
		renderQuickFix();
		expect(screen.queryByRole('group', quickFixGroup)).not.toBeInTheDocument();

		const hasChatModels = contextKeyService.createKey<boolean>(POSIT_HAS_CHAT_MODELS_KEY, false);
		act(() => hasChatModels.set(true));
		expect(screen.getByRole('group', quickFixGroup)).toBeInTheDocument();

		act(() => hasChatModels.set(false));
		expect(screen.queryByRole('group', quickFixGroup)).not.toBeInTheDocument();
	});
});
