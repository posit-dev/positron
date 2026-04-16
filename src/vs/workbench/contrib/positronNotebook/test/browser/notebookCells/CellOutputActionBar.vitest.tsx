/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import React from 'react';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { Event } from '../../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../../test/vitest/vitestUtils.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
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

describe('CellOutputActionBar', () => {
	const disposables = ensureNoLeakedDisposables();
	const rtl = setupRTLRenderer();

	let contextKeyService: MockContextKeyService;
	let menuActions: [string, (MenuItemAction | SubmenuItemAction)[]][];

	beforeEach(() => {
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

		// RTL's act() batches effects, so the menu is created and actions
		// resolved in a single render pass.
		const { container } = rtl.render(element);
		return new CellOutputActionBarFixture(container);
	}

	it('renders empty toolbar when there are no actions', () => {
		menuActions = [];
		const fixture = renderActionBar();

		expect(fixture.toolbar).toBeDefined();
		expect(fixture.buttons.length).toBe(0);
	});

	it('toolbar has an accessible label', () => {
		menuActions = [
			['0_visibility', [mockAction('collapse', 'Collapse', 'chevron-down')]],
		];
		const fixture = renderActionBar();

		expect(fixture.toolbar).toBeDefined();
		expect(fixture.toolbar!.getAttribute('aria-label')).toBe('Cell output actions');
	});

	it('renders buttons for a single group', () => {
		menuActions = [
			['0_visibility', [
				mockAction('collapse', 'Collapse', 'chevron-down'),
				mockAction('expand', 'Expand', 'chevron-right'),
			]],
		];
		const fixture = renderActionBar();

		expect(fixture.buttons.length).toBe(2);
		expect(fixture.separatorButtons.length).toBe(0);
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
		const fixture = renderActionBar();

		expect(fixture.buttons.length).toBe(3);
		expect(fixture.separatorButtons.length).toBe(1);
	});

	it('only shows separator before the last group with three groups', () => {
		menuActions = [
			['0_visibility', [mockAction('collapse', 'Collapse', 'chevron-down')]],
			['1_middle', [mockAction('middle', 'Middle', 'info')]],
			['2_destructive', [mockAction('clear', 'Clear', 'close')]],
		];
		const fixture = renderActionBar();

		expect(fixture.buttons.length).toBe(3);
		expect(fixture.separatorButtons.length).toBe(1);
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

			const fixture = renderActionBar(scrollTargetRef);
			expect(fixture.toolbar).toBeDefined();

			const event = new WheelEvent('wheel', { deltaY: 50, cancelable: true });
			fixture.toolbar!.dispatchEvent(event);

			expect(scrollTarget.scrollTop).toBe(50);
			expect(event.defaultPrevented).toBe(true);
		} finally {
			scrollTarget.remove();
		}
	});
});
