/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ComponentProps } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IContextMenuDelegate } from '../../../../../base/browser/contextmenu.js';
import { IAction } from '../../../../../base/common/actions.js';
import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IErrorActionHandler, IErrorActionsService, IErrorLocation } from '../../../positronAssistant/common/errorActions.js';
import { ErrorActionButtons } from '../../browser/notebookCells/ErrorActionButtons.js';

describe('ErrorActionButtons', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IContextMenuService, { showContextMenu: vi.fn() })
		.stub(IErrorActionsService, { run: async () => { } })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const errorActionHandler: IErrorActionHandler = { id: 'test-agent', label: 'Test Agent', run: async () => { } };
	const location: IErrorLocation = { kind: 'notebook', uri: URI.file('/work/a.ipynb'), cellIndex: 1, code: 'x', languageId: 'python' };

	function renderQuickFix(overrides: Partial<ComponentProps<typeof ErrorActionButtons>> = {}) {
		return rtl.render(
			<ErrorActionButtons
				canContinueChat={true}
				errorActionHandler={errorActionHandler}
				errorOutput={'\u001b[31mNameError: x\u001b[0m'}
				getLocation={() => location}
				groupAriaLabel='Error quick fix actions'
				{...overrides}
			/>
		);
	}

	/** Run the first action in the most recently opened dropdown. */
	async function runDropdownAction(): Promise<void> {
		const showContextMenu = vi.mocked(ctx.get(IContextMenuService).showContextMenu);
		const delegate = showContextMenu.mock.calls.at(-1)?.[0] as IContextMenuDelegate;
		const actions = delegate.getActions() as IAction[];
		await actions[0].run();
	}

	it('sends the ANSI-free error and its location to a new chat', async () => {
		const user = userEvent.setup();
		const run = vi.spyOn(ctx.get(IErrorActionsService), 'run');
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to explain in new chat' }));

		expect(run).toHaveBeenCalledWith(errorActionHandler, 'explain', { error: 'NameError: x', location, chat: 'new' });
	});

	it('resolves the location at click time, not render time', async () => {
		const user = userEvent.setup();
		const run = vi.spyOn(ctx.get(IErrorActionsService), 'run');
		let cellIndex = 1;
		renderQuickFix({ getLocation: () => ({ ...location, cellIndex }) });
		cellIndex = 3;
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' }));

		expect(run.mock.calls.at(-1)?.[2].location).toEqual({ ...location, cellIndex: 3 });
	});

	it('continues the current chat via the fix dropdown action', async () => {
		const user = userEvent.setup();
		const run = vi.spyOn(ctx.get(IErrorActionsService), 'run');
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'More fix options' }));
		await runDropdownAction();

		expect(run).toHaveBeenCalledWith(errorActionHandler, 'fix', { error: 'NameError: x', location, chat: 'current' });
	});

	it('hides the continue-in-current-chat dropdowns when the handler cannot continue a chat', () => {
		renderQuickFix({ canContinueChat: false });
		expect(screen.queryByRole('button', { name: 'More fix options' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'More explain options' })).not.toBeInTheDocument();
	});
});
