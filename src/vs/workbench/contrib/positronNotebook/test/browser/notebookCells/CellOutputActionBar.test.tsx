/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
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

/**
 * Creates a mock MenuItemAction with the minimum fields needed for rendering.
 */
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

class CellOutputActionBarFixture {
	constructor(private readonly container: HTMLElement) { }

	get toolbar() {
		return this.container.querySelector<HTMLDivElement>('[role="toolbar"]');
	}

	get buttons() {
		return this.container.querySelectorAll<HTMLElement>('.action-button');
	}

	get separatorButtons() {
		return this.container.querySelectorAll<HTMLElement>('.action-button.primary-action');
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

	function renderActionBar() {
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
						<CellOutputActionBar cell={cell} />
					</CellScopedContextKeyServiceProvider>
				</NotebookInstanceProvider>
			</PositronReactServicesContext.Provider>
		);

		// TODO: Render three times to settle chained useEffect state updates
		// in useMenu and useMenuActions. Each hook sets state in an effect,
		// requiring a separate render cycle to propagate.
		// https://github.com/posit-dev/positron/issues/12464
		const container = render(element);
		render(element);
		render(element);
		return new CellOutputActionBarFixture(container);
	}

	test('renders nothing when there are no actions', () => {
		menuActions = [];
		const fixture = renderActionBar();

		assert.strictEqual(fixture.toolbar, null);
	});

	test('toolbar has an accessible label', () => {
		menuActions = [
			['0_visibility', [mockAction('collapse', 'Collapse', 'chevron-up')]],
		];
		const fixture = renderActionBar();

		assert.ok(fixture.toolbar);
		assert.strictEqual(fixture.toolbar.getAttribute('aria-label'), 'Cell output actions');
	});

	test('renders buttons for a single group', () => {
		menuActions = [
			['0_visibility', [
				mockAction('collapse', 'Collapse', 'chevron-up'),
				mockAction('expand', 'Expand', 'chevron-down'),
			]],
		];
		const fixture = renderActionBar();

		assert.strictEqual(fixture.buttons.length, 2);
		assert.strictEqual(fixture.separatorButtons.length, 0, 'No separators for a single group');
	});

	test('renders separator before the last group', () => {
		menuActions = [
			['0_visibility', [
				mockAction('collapse', 'Collapse', 'chevron-up'),
				mockAction('expand', 'Expand', 'chevron-down'),
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
			['0_visibility', [mockAction('collapse', 'Collapse', 'chevron-up')]],
			['1_middle', [mockAction('middle', 'Middle', 'info')]],
			['2_destructive', [mockAction('clear', 'Clear', 'close')]],
		];
		const fixture = renderActionBar();

		assert.strictEqual(fixture.buttons.length, 3);
		assert.strictEqual(fixture.separatorButtons.length, 1, 'Only one separator before the last group');
	});
});
