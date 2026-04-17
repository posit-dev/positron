/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import React from 'react';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { Event } from '../../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/react.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { TestCommandService } from '../../../../../../editor/test/browser/editorTestServices.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { PositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../../../../base/browser/positronReactServices.js';
import { CellOutputActionBar } from '../../../browser/notebookCells/CellOutputActionBar.js';
import { CellScopedContextKeyServiceProvider } from '../../../browser/notebookCells/CellContextKeyServiceProvider.js';
import { PositronNotebookCodeCell } from '../../../browser/PositronNotebookCells/PositronNotebookCodeCell.js';
import { IMenu, IMenuService, MenuItemAction, SubmenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';

/* Creates a mock MenuItemAction with the minimum fields needed for rendering. */
function mockAction(id: string, label: string, iconId?: string): MenuItemAction {
	return {
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
	} as unknown as MenuItemAction;
}

/* DOM queries for asserting on rendered CellOutputActionBar structure. */
class CellOutputActionBarFixture {
	constructor(private readonly container: HTMLElement) { }

	get toolbar() {
		return this.container.querySelector<HTMLDivElement>('[role="toolbar"]');
	}

	get buttons() {
		return this.container.querySelectorAll<HTMLElement>('.action-button');
	}

	get separatorButtons() {
		return this.container.querySelectorAll<HTMLElement>('.action-button.separator-after');
	}
}

suite('CellOutputActionBar', () => {
	const { render } = setupReactRenderer();
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let contextKeyService: MockContextKeyService;
	let menuActions: [string, (MenuItemAction | SubmenuItemAction)[]][];

	setup(() => {
		contextKeyService = disposables.add(new MockContextKeyService());
		menuActions = [];
	});

	/* Render the component with mock services and return a fixture for querying. */
	function renderActionBar(scrollTargetRef = React.createRef<HTMLElement | null>()) {
		const instantiationService = disposables.add(new TestInstantiationService());
		const commandService = new TestCommandService(instantiationService);

		const menu: IMenu = {
			onDidChange: Event.None,
			dispose: () => { },
			getActions: () => menuActions,
		};

		const menuService: IMenuService = {
			_serviceBrand: undefined,
			createMenu: () => menu,
			getMenuActions: () => [],
			getMenuContexts: () => new Set(),
			resetHiddenStates: () => { },
		};

		const services = {
			commandService,
			contextKeyService,
			get: (id: any) => {
				if (id === IMenuService) { return menuService; }
				throw new Error(`Unexpected service: ${id}`);
			},
		} as unknown as PositronReactServices;

		const instance = {
			hoverManager: undefined,
		} as unknown as IPositronNotebookInstance;

		const cell = {} as PositronNotebookCodeCell;

		const element = (
			<PositronReactServicesContext.Provider value={services}>
				<NotebookInstanceProvider instance={instance}>
					<CellScopedContextKeyServiceProvider service={contextKeyService}>
						<CellOutputActionBar cell={cell} scrollTargetRef={scrollTargetRef} />
					</CellScopedContextKeyServiceProvider>
				</NotebookInstanceProvider>
			</PositronReactServicesContext.Provider>
		);

		// Render twice: once for the initial render, once for the useMenu
		// effect to create the menu and trigger a re-render. useMenuActions
		// now uses useMemo so it resolves in the same cycle as useMenu.
		const container = render(element);
		render(element);
		return new CellOutputActionBarFixture(container);
	}

	test('renders empty toolbar when there are no actions', () => {
		menuActions = [];
		const fixture = renderActionBar();

		assert.ok(fixture.toolbar);
		assert.strictEqual(fixture.buttons.length, 0);
	});

	test('toolbar has an accessible label', () => {
		menuActions = [
			['0_visibility', [mockAction('collapse', 'Collapse', 'chevron-down')]],
		];
		const fixture = renderActionBar();

		assert.ok(fixture.toolbar);
		assert.strictEqual(fixture.toolbar.getAttribute('aria-label'), 'Cell output actions');
	});

	test('renders buttons for a single group', () => {
		menuActions = [
			['0_visibility', [
				mockAction('collapse', 'Collapse', 'chevron-down'),
				mockAction('expand', 'Expand', 'chevron-right'),
			]],
		];
		const fixture = renderActionBar();

		assert.strictEqual(fixture.buttons.length, 2);
		assert.strictEqual(fixture.separatorButtons.length, 0, 'No separators for a single group');
	});

	test('renders separator before the last group', () => {
		menuActions = [
			['0_visibility', [
				mockAction('collapse', 'Collapse', 'chevron-down'),
				mockAction('expand', 'Expand', 'chevron-right'),
			]],
			['1_destructive', [
				mockAction('clear', 'Clear', 'close'),
			]],
		];
		const fixture = renderActionBar();

		assert.strictEqual(fixture.buttons.length, 3);
		assert.strictEqual(fixture.separatorButtons.length, 1, 'One separator before the last group');
	});

	test('only shows separator before the last group with three groups', () => {
		menuActions = [
			['0_visibility', [mockAction('collapse', 'Collapse', 'chevron-down')]],
			['1_middle', [mockAction('middle', 'Middle', 'info')]],
			['2_destructive', [mockAction('clear', 'Clear', 'close')]],
		];
		const fixture = renderActionBar();

		assert.strictEqual(fixture.buttons.length, 3);
		assert.strictEqual(fixture.separatorButtons.length, 1, 'Only one separator before the last group');
	});

	/* Verify the action bar wires up wheel forwarding (detailed behavior tested in useWheelForwarding.test). */
	test('forwards wheel events to scroll target', () => {
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

			const fixture = renderActionBar(scrollTargetRef);
			assert.ok(fixture.toolbar);

			const event = new WheelEvent('wheel', { deltaY: 50, cancelable: true });
			fixture.toolbar.dispatchEvent(event);

			assert.strictEqual(scrollTarget.scrollTop, 50);
			assert.strictEqual(event.defaultPrevented, true);
		} finally {
			scrollTarget.remove();
		}
	});
});
