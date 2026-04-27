/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IAction } from '../../../../../base/common/actions.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IContextMenuDelegate } from '../../../../../base/browser/contextmenu.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IResourceUsageHistoryService } from '../../../../services/positronConsole/browser/resourceUsageHistoryService.js';
import { IRuntimeSessionMetadata } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestPositronConsoleInstance, TestPositronConsoleService } from '../../../../services/positronConsole/test/browser/testPositronConsoleService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { ConsoleTab } from '../../browser/components/consoleTab.js';
import { PositronConsoleContextProvider } from '../../browser/positronConsoleContext.js';

describe('ConsoleTab', () => {
	describe('rename session', () => {
		const showContextMenu = vi.fn<(delegate: IContextMenuDelegate) => void>();

		const ctx = createTestContainer()
			.withReactServices()
			.stub(IContextMenuService, { showContextMenu })
			.stub(IResourceUsageHistoryService, { getHistory: async () => [] })
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		function addActiveConsoleInstance(sessionId: string, sessionName: string): TestPositronConsoleInstance {
			const sessionMetadata: IRuntimeSessionMetadata = {
				sessionId,
				sessionMode: LanguageRuntimeSessionMode.Console,
				notebookUri: undefined,
				createdTimestamp: 0,
				startReason: 'test',
			};
			// ConsoleTab/RuntimeIcon read base64EncodedIconSvg and languageId off runtimeMetadata.
			const runtimeMetadata = stubInterface<ILanguageRuntimeMetadata>({
				base64EncodedIconSvg: undefined,
				languageId: 'python',
			});
			const instance = new TestPositronConsoleInstance(
				sessionId,
				sessionName,
				sessionMetadata,
				runtimeMetadata,
			);
			const consoleService = ctx.get(IPositronConsoleService) as TestPositronConsoleService;
			consoleService.addTestConsoleInstance(instance);
			return instance;
		}

		async function openRenameInput(instance: TestPositronConsoleInstance, sessionName: string) {
			const user = userEvent.setup();
			rtl.render(
				<PositronConsoleContextProvider>
					<ConsoleTab
						positronConsoleInstance={instance}
						width={200}
						onChangeSession={() => { }}
					/>
				</PositronConsoleContextProvider>
			);

			// Right-click on the tab invokes services.contextMenuService.showContextMenu,
			// which our stub captures so we can drive the Rename action directly.
			await user.pointer({
				keys: '[MouseRight]',
				target: screen.getByRole('tab', { name: sessionName }),
			});

			const delegate = showContextMenu.mock.calls.at(-1)![0];
			const renameAction = (delegate.getActions() as IAction[])
				.find(a => a.id === 'workbench.action.positronConsole.renameConsoleSession');
			expect(renameAction, 'rename action should be in the tab context menu').toBeDefined();

			// Invoking the rename action flips isRenamingSession to true, which mounts
			// the input and fires the useEffect that focuses + selects its text.
			await act(async () => {
				await renameAction!.run();
			});

			return user;
		}

		function spyOnUpdateSessionName() {
			return vi.spyOn(
				ctx.reactServices.runtimeSessionService,
				'updateSessionName'
			).mockImplementation(() => { });
		}

		it('focuses the input and selects the entire session name when rename action is selected', async () => {
			const sessionName = 'My Python Session';
			const instance = addActiveConsoleInstance('test-session-1', sessionName);

			await openRenameInput(instance, sessionName);
			expect(showContextMenu).toHaveBeenCalledOnce();

			const input = screen.getByRole('textbox') as HTMLInputElement;
			expect(input).toHaveFocus();
			expect(input.selectionStart).toBe(0);
			expect(input.selectionEnd).toBe(sessionName.length);
		});

		it('submits the rename via Enter and persists the new name through runtimeSessionService', async () => {
			const sessionName = 'My Python Session';
			const newName = 'Pleasure meeting you here. 👋';
			const instance = addActiveConsoleInstance('test-session-2', sessionName);
			const updateSessionName = spyOnUpdateSessionName();

			const user = await openRenameInput(instance, sessionName);

			// The input mounts with its existing name selected, so typing
			// replaces the selection.
			await user.keyboard(newName);
			await user.keyboard('{Enter}');

			expect(updateSessionName).toHaveBeenCalledWith('test-session-2', newName);
		});

		it('submits the rename on blur', async () => {
			const sessionName = 'My Python Session';
			const newName = 'Renamed via blur';
			const instance = addActiveConsoleInstance('test-session-3', sessionName);
			const updateSessionName = spyOnUpdateSessionName();

			const user = await openRenameInput(instance, sessionName);

			await user.keyboard(newName);
			await user.tab(); // moves focus off the input -> fires onBlur -> handleRenameSubmit

			expect(updateSessionName).toHaveBeenCalledWith('test-session-3', newName);
		});

		it('cancels the rename on Escape without calling updateSessionName', async () => {
			const sessionName = 'My Python Session';
			const instance = addActiveConsoleInstance('test-session-4', sessionName);
			const updateSessionName = spyOnUpdateSessionName();

			const user = await openRenameInput(instance, sessionName);

			await user.keyboard('Some new name the user typed but does not want');
			await user.keyboard('{Escape}');

			expect(updateSessionName).not.toHaveBeenCalled();
			// Input is unmounted; the tab shows the original name.
			expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
			expect(screen.getByRole('tab', { name: sessionName })).toBeInTheDocument();
		});

		it('does not call updateSessionName when the trimmed input is empty', async () => {
			const sessionName = 'My Python Session';
			const instance = addActiveConsoleInstance('test-session-5', sessionName);
			const updateSessionName = spyOnUpdateSessionName();

			const user = await openRenameInput(instance, sessionName);

			// Replace the selected name with whitespace, then submit.
			await user.keyboard('   ');
			await user.keyboard('{Enter}');

			expect(updateSessionName).not.toHaveBeenCalled();
			// Tab shows the original name; rename input is dismissed.
			expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
			expect(screen.getByRole('tab', { name: sessionName })).toBeInTheDocument();
		});

		it('does not call updateSessionName when the input is unchanged', async () => {
			const sessionName = 'My Python Session';
			const instance = addActiveConsoleInstance('test-session-6', sessionName);
			const updateSessionName = spyOnUpdateSessionName();

			const user = await openRenameInput(instance, sessionName);

			// Submit immediately -- name still equals the original.
			await user.keyboard('{Enter}');

			expect(updateSessionName).not.toHaveBeenCalled();
		});

		it('shows a notification and restores the original name when updateSessionName throws', async () => {
			const sessionName = 'My Python Session';
			const newName = 'New name';
			const instance = addActiveConsoleInstance('test-session-7', sessionName);
			vi.spyOn(ctx.reactServices.runtimeSessionService, 'updateSessionName')
				.mockImplementation(() => { throw new Error('rename failed'); });
			const notify = vi.spyOn(ctx.reactServices.notificationService, 'error');

			const user = await openRenameInput(instance, sessionName);

			await user.keyboard(newName);
			await user.keyboard('{Enter}');

			expect(notify).toHaveBeenCalledOnce();
			// Tab still shows the original name.
			expect(screen.getByRole('tab', { name: sessionName })).toBeInTheDocument();
		});
	});
});
