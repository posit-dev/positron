/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { decodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ConsoleQuickFix } from '../../browser/components/activityErrorQuickFix.js';
// --- Start Quick Chat fallback ---
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IQuickChatService } from '../../../../../workbench/contrib/chat/browser/chat.js';
import { Event } from '../../../../../base/common/event.js';
// --- End Quick Chat fallback ---

const line = (id: string, text: string): ANSIOutputLine => ({
	id,
	outputRuns: [{ id: `${id}-run`, text }],
});

const outputLines: ANSIOutputLine[] = [line('1', 'NameError: name "x" is not defined')];
const tracebackLines: ANSIOutputLine[] = [line('2', '  File "<stdin>", line 1')];

const expectedAttachmentText =
	'NameError: name "x" is not defined\n  File "<stdin>", line 1';

const decodeDataUri = (uri: string): string => {
	const base64 = uri.slice(uri.indexOf(',') + 1);
	return VSBuffer.wrap(decodeBase64(base64).buffer).toString();
};

describe('ConsoleQuickFix', () => {
	const executeCommand = vi.fn().mockResolvedValue(undefined);
	const notifyError = vi.fn();
	// --- Start Quick Chat fallback ---
	const openQuickChat = vi.fn();
	let sidebarViewEnabled = true;
	// --- End Quick Chat fallback ---

	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.stub(INotificationService, { error: notifyError })
		// --- Start Quick Chat fallback ---
		.stub(IQuickChatService, { open: openQuickChat })
		.stub(IConfigurationService, {
			getValue: (key: string) => key === 'assistant.sidebarView' ? sidebarViewEnabled : undefined,
			onDidChangeConfiguration: Event.None,
		})
		// --- End Quick Chat fallback ---
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// --- Start Quick Chat fallback ---
	beforeEach(() => {
		sidebarViewEnabled = true;
	});
	// --- End Quick Chat fallback ---

	it('dispatches posit-assistant.newChat with a fix prompt and the error as a data URI attachment when Fix is clicked', async () => {
		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
		await user.click(screen.getByText('Fix'));

		await waitFor(() => expect(executeCommand).toHaveBeenCalledTimes(1));
		const [cmd, payload] = executeCommand.mock.calls[0];
		expect(cmd).toBe('posit-assistant.newChat');
		expect(payload.prompt).toMatch(/fix/i);
		expect(payload.prompt).not.toContain('/fix');
		expect(payload.target).toBe('auto');
		expect(payload.behavior).toBe('submit');
		expect(payload.files).toHaveLength(1);
		expect(payload.files[0].name).toBe('console-error.txt');
		expect(payload.files[0].uri).toMatch(/^data:text\/plain;base64,/);
		expect(decodeDataUri(payload.files[0].uri)).toBe(expectedAttachmentText);
	});

	it('dispatches posit-assistant.newChat with an explain prompt when Explain is clicked', async () => {
		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
		await user.click(screen.getByText('Explain'));

		await waitFor(() => expect(executeCommand).toHaveBeenCalledTimes(1));
		const [, payload] = executeCommand.mock.calls[0];
		expect(payload.prompt).toMatch(/explain/i);
		expect(payload.prompt).not.toContain('/explain');
		expect(payload.target).toBe('auto');
	});

	it('omits the attachment when there is no error output', async () => {
		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix outputLines={[]} tracebackLines={[]} />);
		await user.click(screen.getByText('Fix'));

		await waitFor(() => expect(executeCommand).toHaveBeenCalledTimes(1));
		const [, payload] = executeCommand.mock.calls[0];
		expect(payload.files).toBeUndefined();
	});

	it('surfaces a notification when the command throws (extension missing)', async () => {
		executeCommand.mockRejectedValueOnce(new Error('command not found'));

		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
		await user.click(screen.getByText('Fix'));

		await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
		expect(notifyError.mock.calls[0][0]).toMatch(/Posit Assistant is not available/);
	});

	// --- Start Quick Chat fallback ---
	describe('with assistant.sidebarView disabled', () => {
		beforeEach(() => {
			sidebarViewEnabled = false;
		});

		it('opens the quick chat with the /fix slash command and fenced error block when Fix is clicked', async () => {
			const user = userEvent.setup();
			rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
			await user.click(screen.getByText('Fix'));

			expect(openQuickChat).toHaveBeenCalledTimes(1);
			const [options] = openQuickChat.mock.calls[0];
			expect(options.query).toBe(`/fix\n\`\`\`${expectedAttachmentText}\`\`\``);
			expect(executeCommand).not.toHaveBeenCalled();
		});

		it('opens the quick chat with the /explain slash command when Explain is clicked', async () => {
			const user = userEvent.setup();
			rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
			await user.click(screen.getByText('Explain'));

			expect(openQuickChat).toHaveBeenCalledTimes(1);
			const [options] = openQuickChat.mock.calls[0];
			expect(options.query).toBe(`/explain\n\`\`\`${expectedAttachmentText}\`\`\``);
			expect(executeCommand).not.toHaveBeenCalled();
		});

		it('opens the quick chat with just the slash command when there is no error output', async () => {
			const user = userEvent.setup();
			rtl.render(<ConsoleQuickFix outputLines={[]} tracebackLines={[]} />);
			await user.click(screen.getByText('Fix'));

			expect(openQuickChat).toHaveBeenCalledTimes(1);
			const [options] = openQuickChat.mock.calls[0];
			expect(options.query).toBe('/fix');
		});
	});
	// --- End Quick Chat fallback ---
});
