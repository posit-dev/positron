/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ComponentProps } from 'react';
import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IContextMenuDelegate } from '../../../../../base/browser/contextmenu.js';
import { IAction } from '../../../../../base/common/actions.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IErrorActionContext, IErrorActionHandler, IErrorActionsService } from '../../../positronAssistant/common/errorActions.js';
import { AssistantErrorQuickFix } from '../../browser/notebookCells/AssistantErrorQuickFix.js';

describe('AssistantErrorQuickFix', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IContextMenuService, { showContextMenu: vi.fn() })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const run = vi.fn();

	/** Register the handler errors are sent to. */
	function registerHandler(options: Partial<IErrorActionHandler> = {}): IDisposable {
		return ctx.disposables.add(ctx.get(IErrorActionsService).register({ id: 'test-agent', label: 'Test Agent', canContinueChat: true, run, ...options }));
	}

	beforeEach(() => {
		run.mockReset().mockResolvedValue(undefined);
	});

	const errorContext: Omit<IErrorActionContext, 'chat'> = {
		error: 'NameError: name "x" is not defined',
		location: { kind: 'notebook' },
	};

	function renderQuickFix(overrides: Partial<ComponentProps<typeof AssistantErrorQuickFix>> = {}) {
		return rtl.render(
			<AssistantErrorQuickFix
				getErrorContext={() => errorContext}
				groupAriaLabel='Error quick fix actions'
				{...overrides}
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

	it('sends Fix and Explain to a new chat', async () => {
		registerHandler();
		const user = userEvent.setup();
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' }));
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to explain in new chat' }));

		expect(run.mock.calls).toEqual([
			['fix', { ...errorContext, chat: 'new' }],
			['explain', { ...errorContext, chat: 'new' }],
		]);
	});

	it('continues the current chat from the dropdowns', async () => {
		registerHandler();
		const user = userEvent.setup();
		renderQuickFix();
		await runDropdownAction(user, 'More fix options');
		await runDropdownAction(user, 'More explain options');

		expect(run.mock.calls).toEqual([
			['fix', { ...errorContext, chat: 'current' }],
			['explain', { ...errorContext, chat: 'current' }],
		]);
	});

	it('resolves the error context at click time, not render time', async () => {
		registerHandler();
		const user = userEvent.setup();
		let error = 'stale location';
		renderQuickFix({ getErrorContext: () => ({ ...errorContext, error }) });
		error = 'fresh location';
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' }));

		expect(run.mock.calls[0][1].error).toBe('fresh location');
	});

	it('shows the buttons only while a handler is registered', () => {
		renderQuickFix();
		expect(screen.queryByRole('group', { name: 'Error quick fix actions' })).not.toBeInTheDocument();

		let registration: IDisposable | undefined;
		act(() => { registration = registerHandler(); });
		expect(screen.getByRole('group', { name: 'Error quick fix actions' })).toBeInTheDocument();

		act(() => registration?.dispose());
		expect(screen.queryByRole('group', { name: 'Error quick fix actions' })).not.toBeInTheDocument();
	});

	it('names the handler in the dropdown actions', async () => {
		registerHandler();
		const user = userEvent.setup();
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'More fix options' }));
		await user.click(screen.getByRole('button', { name: 'More explain options' }));

		const showContextMenu = vi.mocked(ctx.get(IContextMenuService).showContextMenu);
		const labels = showContextMenu.mock.calls.map(([delegate]) => (delegate as IContextMenuDelegate).getActions().map(action => action.label));
		expect(labels).toEqual([['Ask Test Agent to fix in current chat'], ['Ask Test Agent to explain in current chat']]);
	});

	it('offers no dropdowns when the handler cannot continue the current chat', () => {
		registerHandler({ canContinueChat: false });
		renderQuickFix();

		expect(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'More fix options' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'More explain options' })).not.toBeInTheDocument();
	});
});
