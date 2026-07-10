/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ComponentProps } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IContextMenuDelegate } from '../../../../../base/browser/contextmenu.js';
import { IAction } from '../../../../../base/common/actions.js';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { POSIT_NEW_CHAT_COMMAND, NewChatOptions } from '../../../positronAssistant/browser/positAssistantChat.js';
import { AssistantErrorQuickFix } from '../../browser/notebookCells/AssistantErrorQuickFix.js';

describe('AssistantErrorQuickFix', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand: vi.fn().mockResolvedValue(undefined) })
		.stub(IContextMenuService, { showContextMenu: vi.fn() })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const defaultPayload = {
		fixPrompt: 'Fix this test error.',
		explainPrompt: 'Explain this test error.',
		attachmentContent: 'NameError: name "x" is not defined',
	};

	const defaultProps = {
		getPayload: () => defaultPayload,
		attachmentName: 'test-error.txt',
		groupAriaLabel: 'Error quick fix actions',
	};

	function renderQuickFix(overrides: Partial<ComponentProps<typeof AssistantErrorQuickFix>> = {}) {
		return rtl.render(<AssistantErrorQuickFix {...defaultProps} {...overrides} />);
	}

	/** The newChat payload from the most recent executeCommand call. */
	function lastNewChatOptions(): NewChatOptions {
		const executeCommand = vi.mocked(ctx.get(ICommandService).executeCommand);
		const lastCall = executeCommand.mock.calls.at(-1);
		expect(lastCall?.[0]).toBe(POSIT_NEW_CHAT_COMMAND);
		return lastCall?.[1] as NewChatOptions;
	}

	function decodeAttachment(uri: string): string {
		return decodeBase64(uri.replace('data:text/plain;base64,', '')).toString();
	}

	it('sends the fix prompt and error attachment to a new chat', async () => {
		const user = userEvent.setup();
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'Ask assistant to fix in new chat' }));

		const options = lastNewChatOptions();
		expect({
			...options,
			files: options.files?.map(file => ({ name: file.name, content: decodeAttachment(file.uri) })),
		}).toEqual({
			prompt: 'Fix this test error.',
			target: 'new',
			behavior: 'submit',
			files: [{ name: 'test-error.txt', content: 'NameError: name "x" is not defined' }],
		});
	});

	it('appends the explain-only constraint to the explain prompt', async () => {
		const user = userEvent.setup();
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'Ask assistant to explain in new chat' }));

		expect(lastNewChatOptions().prompt).toBe(
			'Explain this test error. Do not make changes or edit any files; just explain the error.'
		);
	});

	it('strips ANSI escape codes from the attachment', async () => {
		const user = userEvent.setup();
		renderQuickFix({ getPayload: () => ({ ...defaultPayload, attachmentContent: '\u001b[31mboom\u001b[0m' }) });
		await user.click(screen.getByRole('button', { name: 'Ask assistant to fix in new chat' }));

		const files = lastNewChatOptions().files;
		expect(files && decodeAttachment(files[0].uri)).toBe('boom');
	});

	it('omits the attachment when the error content is blank', async () => {
		const user = userEvent.setup();
		renderQuickFix({ getPayload: () => ({ ...defaultPayload, attachmentContent: '   ' }) });
		await user.click(screen.getByRole('button', { name: 'Ask assistant to fix in new chat' }));

		expect(lastNewChatOptions().files).toBeUndefined();
	});

	it('resolves the payload at click time, not render time', async () => {
		const user = userEvent.setup();
		let attachmentContent = 'stale location';
		renderQuickFix({ getPayload: () => ({ ...defaultPayload, attachmentContent }) });
		attachmentContent = 'fresh location';
		await user.click(screen.getByRole('button', { name: 'Ask assistant to fix in new chat' }));

		const files = lastNewChatOptions().files;
		expect(files && decodeAttachment(files[0].uri)).toBe('fresh location');
	});

	it('continues in the current chat via the fix dropdown action', async () => {
		const user = userEvent.setup();
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'More fix options' }));

		const showContextMenu = vi.mocked(ctx.get(IContextMenuService).showContextMenu);
		const delegate = showContextMenu.mock.calls.at(-1)?.[0] as IContextMenuDelegate;
		const actions = delegate.getActions() as IAction[];
		await actions[0].run();

		const options = lastNewChatOptions();
		expect(options.target).toBe('auto');
		expect(options.prompt).toBe('Fix this test error.');
	});

});
