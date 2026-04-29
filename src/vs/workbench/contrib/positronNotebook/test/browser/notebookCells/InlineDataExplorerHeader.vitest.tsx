/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Event } from '../../../../../../base/common/event.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IMenu, IMenuService, MenuItemAction, SubmenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { CellScopedContextKeyServiceProvider } from '../../../browser/notebookCells/CellContextKeyServiceProvider.js';
import { InlineDataExplorerHeader } from '../../../browser/notebookCells/InlineDataExplorer.js';
import type { IInlineDataExplorerActionContext } from '../../../browser/notebookCells/InlineDataExplorerActions.js';

/** Minimal MenuItemAction stub for rendering and click dispatch. */
function mockAction(id: string, label: string, iconId: string, run: (...args: unknown[]) => Promise<unknown> = () => Promise.resolve()): MenuItemAction {
	return stubInterface<MenuItemAction>({
		id,
		label,
		tooltip: '',
		item: {
			id,
			title: label,
			icon: ThemeIcon.fromId(iconId),
		},
		run,
	});
}

function buildActionContext(): IInlineDataExplorerActionContext {
	return {
		documentUri: URI.parse('file:///nb.ipynb'),
		sourceLanguage: 'python',
		commId: 'comm-1',
		variablePath: ['df'],
		title: 'df',
		shape: { rows: 10, columns: 5 },
		gridInstance: undefined,
	};
}

describe('InlineDataExplorerHeader', () => {
	let menuActions: [string, (MenuItemAction | SubmenuItemAction)[]][] = [];
	const getActions = vi.fn(() => menuActions);

	// Closes over menuActions which is reassigned per-test; getActions resolves
	// the live binding at render time.
	const menu: IMenu = {
		onDidChange: Event.None,
		dispose: () => { },
		getActions,
	};

	const contextKeyService = new MockContextKeyService();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IMenuService, { createMenu: () => menu })
		.stub(IContextKeyService, contextKeyService)
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		menuActions = [];
	});

	function renderHeader(actionContext: IInlineDataExplorerActionContext | undefined) {
		return rtl.render(
			<CellScopedContextKeyServiceProvider service={contextKeyService}>
				<InlineDataExplorerHeader
					actionContext={actionContext}
					shape={{ rows: 1234, columns: 5 }}
					title='df'
				/>
			</CellScopedContextKeyServiceProvider>
		);
	}

	it('renders title and shape', () => {
		renderHeader(undefined);
		expect(screen.getByText('df')).toBeInTheDocument();
		expect(screen.getByText(/1,234 rows x 5 columns/)).toBeInTheDocument();
	});

	it('renders registered menu actions when actionContext is provided', () => {
		menuActions = [['navigation', [mockAction('test.openExplorer', 'Open in Data Explorer', 'go-to-file')]]];
		renderHeader(buildActionContext());
		expect(screen.getByRole('button', { name: /Open in Data Explorer/ })).toBeInTheDocument();
	});

	it('does not render action buttons when actionContext is undefined', () => {
		menuActions = [['navigation', [mockAction('test.openExplorer', 'Open in Data Explorer', 'go-to-file')]]];
		renderHeader(undefined);
		expect(screen.queryByRole('button', { name: /Open in Data Explorer/ })).not.toBeInTheDocument();
	});

	it('invokes action.run with the provided context on click', async () => {
		const user = userEvent.setup();
		const run = vi.fn().mockResolvedValue(undefined);
		menuActions = [['navigation', [mockAction('test.openExplorer', 'Open in Data Explorer', 'go-to-file', run)]]];
		const actionCtx = buildActionContext();
		renderHeader(actionCtx);

		await user.click(screen.getByRole('button', { name: /Open in Data Explorer/ }));

		expect(run).toHaveBeenCalledWith(actionCtx);
	});

	// Regression: MenuItemAction.run drops caller-supplied args unless
	// shouldForwardArgs is set on the menu options. Without this, ctx never
	// reaches the registered Action2 and run() throws on `ctx.commId`.
	it('requests menu actions with shouldForwardArgs so ctx flows through', () => {
		renderHeader(undefined);
		expect(getActions).toHaveBeenCalledWith(expect.objectContaining({ shouldForwardArgs: true }));
	});
});
