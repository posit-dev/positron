/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IAction } from '../../../../../../base/common/actions.js';
import { decodeBase64, VSBuffer } from '../../../../../../base/common/buffer.js';
import { Event } from '../../../../../../base/common/event.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IContextMenuService } from '../../../../../../platform/contextview/browser/contextView.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { NotebookCellQuickFix } from '../../../browser/notebookCells/NotebookCellQuickFix.js';

const errorContent = '\x1b[31mNameError: name "x" is not defined\x1b[0m';

const decodeDataUri = (uri: string): string => {
	const base64 = uri.slice(uri.indexOf(',') + 1);
	return VSBuffer.wrap(decodeBase64(base64).buffer).toString();
};

describe('NotebookCellQuickFix', () => {
	const executeCommand = vi.fn().mockResolvedValue(undefined);
	const showContextMenu = vi.fn();
	let dropdownActions: IAction[] = [];

	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.stub(IContextMenuService, {
			onDidShowContextMenu: Event.None,
			onDidHideContextMenu: Event.None,
			showContextMenu,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		executeCommand.mockReset();
		executeCommand.mockResolvedValue(undefined);
		showContextMenu.mockReset();
		showContextMenu.mockImplementation((delegate: { getActions?: () => IAction[] }) => {
			dropdownActions = delegate.getActions?.() ?? [];
		});
		dropdownActions = [];

		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		const contextKeyService = ctx.get(IContextKeyService) as MockContextKeyService;
		configurationService.setUserConfiguration('positron.assistant.enable', true);
		configurationService.setUserConfiguration('positron.notebook.enabled', true);
		contextKeyService.createKey('positron-assistant.hasChatModels', true);
	});

	it('dispatches posit-assistant.newChat with error attachment on Fix click', async () => {
		const user = userEvent.setup();
		rtl.render(<NotebookCellQuickFix errorContent={errorContent} />);

		await user.click(screen.getByRole('button', { name: /ask assistant to fix in new chat/i }));

		await waitFor(() => expect(executeCommand).toHaveBeenCalledTimes(1));
		const [command, payload] = executeCommand.mock.calls[0];
		expect(command).toBe('posit-assistant.newChat');
		expect(payload.prompt).toMatch(/fix/i);
		expect(payload.target).toBe('new');
		expect(payload.behavior).toBe('submit');
		expect(payload.files).toHaveLength(1);
		expect(payload.files[0].name).toBe('notebook-cell-error.txt');
		expect(payload.files[0].uri).toMatch(/^data:text\/plain;base64,/);
		expect(decodeDataUri(payload.files[0].uri)).toBe('NameError: name "x" is not defined');
	});

	it('dispatches posit-assistant.newChat with target "auto" for dropdown action', async () => {
		const user = userEvent.setup();
		rtl.render(<NotebookCellQuickFix errorContent={errorContent} />);

		await user.click(screen.getByRole('button', { name: /more fix options/i }));
		expect(dropdownActions).toHaveLength(1);
		await dropdownActions[0].run();

		await waitFor(() => expect(executeCommand).toHaveBeenCalledTimes(1));
		const [command, payload] = executeCommand.mock.calls[0];
		expect(command).toBe('posit-assistant.newChat');
		expect(payload.target).toBe('auto');
	});

});
