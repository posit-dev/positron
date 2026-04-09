/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../base/test/browser/react.js';
import { IMenu, IMenuChangeEvent, IMenuService, MenuId, MenuItemAction, SubmenuItemAction } from '../../../../../platform/actions/common/actions.js';
import { IVersionedMenu, useMenu } from '../../browser/useMenu.js';
import { useMenuActions } from '../../browser/useMenuActions.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { PositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';

type Actions = [string, (MenuItemAction | SubmenuItemAction)[]][];

/** Harness that renders useMenuActions with a directly controlled IVersionedMenu. */
function UseMenuActionsHarness({ menu, onActions }: {
	menu: IVersionedMenu;
	onActions: (a: Actions) => void;
}) {
	const actions = useMenuActions(menu);
	onActions(actions);
	return null;
}

/** Harness that composes useMenu + useMenuActions the way real components do. */
function ComposedHarness({ contextKeyService, onActions }: {
	contextKeyService: MockContextKeyService | undefined;
	onActions: (a: Actions) => void;
}) {
	const menu = useMenu(MenuId.CommandPalette, contextKeyService);
	const actions = useMenuActions(menu);
	onActions(actions);
	return null;
}

suite('useMenuActions', () => {
	const { render } = setupReactRenderer();
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const action = (id: string) => ({ id }) as MenuItemAction;

	suite('standalone', () => {
		test('returns empty array when menu.current is undefined', () => {
			let captured: Actions = [];
			const menu: IVersionedMenu = { current: undefined, version: 0 };

			render(<UseMenuActionsHarness menu={menu} onActions={a => { captured = a; }} />);
			assert.deepStrictEqual(captured, []);
		});

		test('returns actions when menu.current is present', () => {
			let captured: Actions = [];
			const expected: Actions = [['group', [action('a1'), action('a2')]]];
			const menu: IVersionedMenu = {
				current: { getActions: () => expected } as unknown as IMenu,
				version: 0,
			};

			render(<UseMenuActionsHarness menu={menu} onActions={a => { captured = a; }} />);
			assert.deepStrictEqual(captured, expected);
		});

		test('updates when version changes', () => {
			let captured: Actions = [];
			const actionsV0: Actions = [['g', [action('old')]]];
			const actionsV1: Actions = [['g', [action('new')]]];
			let currentActions = actionsV0;

			const mockMenu = { getActions: () => currentActions } as unknown as IMenu;

			render(<UseMenuActionsHarness
				menu={{ current: mockMenu, version: 0 }}
				onActions={a => { captured = a; }}
			/>);
			assert.deepStrictEqual(captured, actionsV0);

			currentActions = actionsV1;
			render(<UseMenuActionsHarness
				menu={{ current: mockMenu, version: 1 }}
				onActions={a => { captured = a; }}
			/>);
			assert.deepStrictEqual(captured, actionsV1);
		});
	});

	suite('composed with useMenu', () => {
		let contextKeyService: MockContextKeyService;
		let menuActions: Actions;
		let onDidChange: Emitter<IMenuChangeEvent>;

		setup(() => {
			contextKeyService = disposables.add(new MockContextKeyService());
			menuActions = [];
			onDidChange = disposables.add(new Emitter<IMenuChangeEvent>());
		});

		function createServices(): PositronReactServices {
			const menu: IMenu = {
				onDidChange: onDidChange.event,
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
			return {
				get: (id: any) => {
					if (id === IMenuService) { return menuService; }
					throw new Error(`Unexpected service: ${id}`);
				},
			} as unknown as PositronReactServices;
		}

		test('resolves actions in the same render as useMenu', () => {
			menuActions = [['g', [action('a1')]]];
			let captured: Actions = [];
			const services = createServices();

			const element = (
				<PositronReactServicesContext.Provider value={services}>
					<ComposedHarness
						contextKeyService={contextKeyService}
						onActions={a => { captured = a; }}
					/>
				</PositronReactServicesContext.Provider>
			);

			// Render 1: initial (effect queued, menu undefined)
			render(element);
			assert.deepStrictEqual(captured, [], 'no actions before effect settles');

			// Render 2: effect creates menu; useMemo resolves actions in same cycle
			render(element);
			assert.deepStrictEqual(captured, [['g', [action('a1')]]]);
		});

		test('updates actions when menu fires onDidChange', () => {
			menuActions = [['g', [action('v0')]]];
			let captured: Actions = [];
			const services = createServices();

			const element = (
				<PositronReactServicesContext.Provider value={services}>
					<ComposedHarness
						contextKeyService={contextKeyService}
						onActions={a => { captured = a; }}
					/>
				</PositronReactServicesContext.Provider>
			);

			render(element);
			render(element);
			assert.deepStrictEqual(captured, [['g', [action('v0')]]]);

			// Simulate menu content change
			menuActions = [['g', [action('v1')]]];
			onDidChange.fire({} as IMenuChangeEvent);

			// One render to pick up the version bump
			render(element);
			assert.deepStrictEqual(captured, [['g', [action('v1')]]]);
		});

		test('clears actions when contextKeyService becomes undefined', () => {
			menuActions = [['g', [action('a1')]]];
			let captured: Actions = [];
			const services = createServices();

			const withService = (
				<PositronReactServicesContext.Provider value={services}>
					<ComposedHarness
						contextKeyService={contextKeyService}
						onActions={a => { captured = a; }}
					/>
				</PositronReactServicesContext.Provider>
			);
			render(withService);
			render(withService);
			assert.deepStrictEqual(captured, [['g', [action('a1')]]]);

			// Remove contextKeyService -- actions must clear synchronously
			render(
				<PositronReactServicesContext.Provider value={services}>
					<ComposedHarness
						contextKeyService={undefined}
						onActions={a => { captured = a; }}
					/>
				</PositronReactServicesContext.Provider>
			);
			assert.deepStrictEqual(captured, [], 'actions must clear when service disappears');
		});
	});
});
