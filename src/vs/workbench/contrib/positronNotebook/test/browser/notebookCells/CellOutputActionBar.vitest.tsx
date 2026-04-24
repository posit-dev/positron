/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { screen } from '@testing-library/react';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { Event } from '../../../../../../base/common/event.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { CellOutputActionBar } from '../../../browser/notebookCells/CellOutputActionBar.js';
import { CellScopedContextKeyServiceProvider } from '../../../browser/notebookCells/CellContextKeyServiceProvider.js';
import { PositronNotebookCodeCell } from '../../../browser/PositronNotebookCells/PositronNotebookCodeCell.js';
import { IMenu, IMenuService, MenuItemAction, SubmenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';

/* Creates a mock MenuItemAction with the minimum fields needed for rendering. */
function mockAction(id: string, label: string, iconId?: string): MenuItemAction {
	return stubInterface<MenuItemAction>({
		id,
		label,
		tooltip: '',
		enabled: true,
		item: {
			id,
			title: label,
			icon: iconId ? ThemeIcon.fromId(iconId) : undefined,
		},
		run: () => Promise.resolve(),
		dispose: () => { },
	});
}

describe('CellOutputActionBar', () => {
	let menuActions: [string, (MenuItemAction | SubmenuItemAction)[]][] = [];

	// Promoted to describe scope: menu.getActions closes over menuActions,
	// which is reassigned in each test. The closure resolves the live binding
	// when the component calls getActions() during render.
	const menu: IMenu = {
		onDidChange: Event.None,
		dispose: () => { },
		getActions: () => menuActions,
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

	/* Render the component and return the RTL render result for querying. */
	function renderActionBar(scrollTargetRef = React.createRef<HTMLElement | null>()) {
		// The action bar only reads instance.hoverManager from the instance;
		// stubInterface gives a typed object and lets unused members throw if
		// anything else is read.
		const instance = stubInterface<IPositronNotebookInstance>({
			hoverManager: undefined,
		});

		// The action bar passes the cell through without dereferencing it in this test;
		// stubInterface gives the typed "never read" stub.
		const cell = stubInterface<PositronNotebookCodeCell>();

		// RTL's act() batches effects, so the menu is created and actions
		// resolved in a single render pass.
		return rtl.render(
			<NotebookInstanceProvider instance={instance}>
				<CellScopedContextKeyServiceProvider service={contextKeyService}>
					<CellOutputActionBar cell={cell} scrollTargetRef={scrollTargetRef} />
				</CellScopedContextKeyServiceProvider>
			</NotebookInstanceProvider>
		);
	}

	it('renders empty toolbar when there are no actions', () => {
		menuActions = [];
		renderActionBar();

		expect(screen.getByRole('toolbar')).toBeInTheDocument();
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});

	it('toolbar has an accessible label', () => {
		menuActions = [
			['0_visibility', [mockAction('collapse', 'Collapse', 'chevron-down')]],
		];
		renderActionBar();

		expect(screen.getByRole('toolbar', { name: 'Cell output actions' })).toBeInTheDocument();
	});

	/**
	 * Filters rendered buttons down to those marked as group separators.
	 * The separator is a class-only visual marker applied to the last button
	 * in a non-final group; it has no role or testid, so we read it off the
	 * already-semantically-queried button elements.
	 */
	function getSeparators(): HTMLElement[] {
		return screen.getAllByRole('button').filter(b => b.classList.contains('separator-after'));
	}

	it('renders buttons for a single group', () => {
		menuActions = [
			['0_visibility', [
				mockAction('collapse', 'Collapse', 'chevron-down'),
				mockAction('expand', 'Expand', 'chevron-right'),
			]],
		];
		renderActionBar();

		expect(screen.getAllByRole('button')).toHaveLength(2);
		expect(getSeparators(), 'No separators for a single group').toHaveLength(0);
	});

	it('renders separator before the last group', () => {
		menuActions = [
			['0_visibility', [
				mockAction('collapse', 'Collapse', 'chevron-down'),
				mockAction('expand', 'Expand', 'chevron-right'),
			]],
			['1_destructive', [
				mockAction('clear', 'Clear', 'close'),
			]],
		];
		renderActionBar();

		expect(screen.getAllByRole('button')).toHaveLength(3);
		expect(getSeparators(), 'One separator before the last group').toHaveLength(1);
	});

	it('only shows separator before the last group with three groups', () => {
		menuActions = [
			['0_visibility', [mockAction('collapse', 'Collapse', 'chevron-down')]],
			['1_middle', [mockAction('middle', 'Middle', 'info')]],
			['2_destructive', [mockAction('clear', 'Clear', 'close')]],
		];
		renderActionBar();

		expect(screen.getAllByRole('button')).toHaveLength(3);
		expect(getSeparators(), 'Only one separator before the last group').toHaveLength(1);
	});

	/* Verify the action bar wires up wheel forwarding (detailed behavior tested in useWheelForwarding.test). */
	it('forwards wheel events to scroll target', () => {
		menuActions = [
			['0_visibility', [mockAction('collapse', 'Collapse', 'chevron-down')]],
		];
		const scrollTarget = mainWindow.document.createElement('div');
		scrollTarget.style.overflow = 'auto';
		scrollTarget.style.width = '100px';
		scrollTarget.style.height = '50px';
		const inner = mainWindow.document.createElement('div');
		inner.style.width = '300px';
		inner.style.height = '300px';
		scrollTarget.appendChild(inner);
		mainWindow.document.body.appendChild(scrollTarget);

		try {
			const scrollTargetRef = React.createRef<HTMLElement | null>();
			scrollTargetRef.current = scrollTarget;

			renderActionBar(scrollTargetRef);
			const toolbar = screen.getByRole('toolbar');
			expect(toolbar).toBeInTheDocument();

			const event = new WheelEvent('wheel', { deltaY: 50, cancelable: true });
			toolbar.dispatchEvent(event);

			expect(scrollTarget.scrollTop).toBe(50);
			expect(event.defaultPrevented).toBe(true);
		} finally {
			scrollTarget.remove();
		}
	});
});
