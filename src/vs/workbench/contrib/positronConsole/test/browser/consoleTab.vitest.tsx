/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */

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
			const runtimeMetadata = { base64EncodedIconSvg: undefined, languageId: 'python' } as ILanguageRuntimeMetadata;
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

		it('focuses the input and selects the entire session name when rename action is selected', async () => {
			const user = userEvent.setup();
			const sessionName = 'My Python Session';
			const instance = addActiveConsoleInstance('test-session-1', sessionName);

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
			expect(showContextMenu).toHaveBeenCalledOnce();

			const delegate = showContextMenu.mock.calls[0][0];
			const renameAction = (delegate.getActions() as IAction[])
				.find(a => a.id === 'workbench.action.positronConsole.renameConsoleSession');
			expect(renameAction).toBeDefined();

			// Invoking the rename action flips isRenamingSession to true, which mounts
			// the input and fires the useEffect that focuses + selects its text.
			await act(async () => {
				await renameAction?.run();
			});

			const input = screen.getByRole('textbox') as HTMLInputElement;
			expect(input).toHaveFocus();
			expect(input.selectionStart).toBe(0);
			expect(input.selectionEnd).toBe(sessionName.length);
		});
	});
});
