/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ComponentProps } from 'react';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IContextMenuDelegate } from '../../../../../base/browser/contextmenu.js';
import { IAction } from '../../../../../base/common/actions.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IErrorAssistant, IErrorAssistantContext, IErrorAssistantService } from '../../../positronAssistant/common/errorAssistant.js';
import { registerTestErrorAssistant } from '../../../positronAssistant/test/browser/errorAssistantTestUtils.js';
import { AssistantErrorQuickFix } from '../../browser/notebookCells/AssistantErrorQuickFix.js';

describe('AssistantErrorQuickFix', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IContextMenuService, { showContextMenu: vi.fn() })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const ask = vi.fn();

	beforeEach(() => {
		ask.mockReset().mockResolvedValue(undefined);
	});

	const errorContext: IErrorAssistantContext = {
		kind: 'notebook',
		error: 'NameError: name "x" is not defined',
	};

	/** Register an assistant errors are sent to, and render the quick fix for it. */
	function renderQuickFix(options: Partial<IErrorAssistant> = {}, overrides: Partial<ComponentProps<typeof AssistantErrorQuickFix>> = {}) {
		registerTestErrorAssistant(ctx, { ask, ...options });
		return rtl.render(
			<AssistantErrorQuickFix
				assistant={ctx.get(IErrorAssistantService).activeAssistant!}
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
		const user = userEvent.setup();
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' }));
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to explain in new chat' }));

		expect(ask.mock.calls).toEqual([
			['fix', errorContext, { continueChat: false }],
			['explain', errorContext, { continueChat: false }],
		]);
	});

	it('continues the active chat from the dropdowns', async () => {
		const user = userEvent.setup();
		renderQuickFix();
		await runDropdownAction(user, 'More fix options');
		await runDropdownAction(user, 'More explain options');

		expect(ask.mock.calls).toEqual([
			['fix', errorContext, { continueChat: true }],
			['explain', errorContext, { continueChat: true }],
		]);
	});

	it('resolves the error context at click time, not render time', async () => {
		const user = userEvent.setup();
		let error = 'stale location';
		renderQuickFix({}, { getErrorContext: () => ({ ...errorContext, error }) });
		error = 'fresh location';
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' }));

		expect(ask.mock.calls[0][1].error).toBe('fresh location');
	});

	it('names the assistant in the dropdown actions', async () => {
		const user = userEvent.setup();
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'More fix options' }));
		await user.click(screen.getByRole('button', { name: 'More explain options' }));

		const showContextMenu = vi.mocked(ctx.get(IContextMenuService).showContextMenu);
		const labels = showContextMenu.mock.calls.map(([delegate]) => (delegate as IContextMenuDelegate).getActions().map(action => action.label));
		expect(labels).toEqual([['Ask Test Agent to fix in current chat'], ['Ask Test Agent to explain in current chat']]);
	});

	it('offers no dropdowns when the assistant cannot continue the active chat', () => {
		renderQuickFix({ supportsChatContinuation: false });

		expect(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'More fix options' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'More explain options' })).not.toBeInTheDocument();
	});
});
