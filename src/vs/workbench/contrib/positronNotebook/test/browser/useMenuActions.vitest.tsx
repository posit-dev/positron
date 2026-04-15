/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */

import sinon from 'sinon';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../base/test/common/vitestUtils.js';
import { setupRTLRenderer } from '../../../../../base/test/browser/reactTestingLibrary.js';
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

describe('useMenuActions', () => {
	const disposables = ensureNoLeakedDisposables();
	const rtl = setupRTLRenderer();

	const action = (id: string) => ({ id }) as MenuItemAction;

	describe('standalone', () => {
		it('returns empty array when menu.current is undefined', () => {
			let captured: Actions = [];
			const menu: IVersionedMenu = { current: undefined, version: 0 };

			rtl.render(<UseMenuActionsHarness menu={menu} onActions={a => { captured = a; }} />);
			expect(captured).toEqual([]);
		});

		it('returns actions when menu.current is present', () => {
			let captured: Actions = [];
			const expected: Actions = [['group', [action('a1'), action('a2')]]];
			const menu: IVersionedMenu = {
				current: { getActions: () => expected } as unknown as IMenu,
				version: 0,
			};

			rtl.render(<UseMenuActionsHarness menu={menu} onActions={a => { captured = a; }} />);
			expect(captured).toEqual(expected);
		});

		it('updates when version changes', () => {
			let captured: Actions = [];
			const actionsV0: Actions = [['g', [action('old')]]];
			const actionsV1: Actions = [['g', [action('new')]]];
			let currentActions = actionsV0;

			const mockMenu = { getActions: () => currentActions } as unknown as IMenu;

			const { rerender } = rtl.render(<UseMenuActionsHarness
				menu={{ current: mockMenu, version: 0 }}
				onActions={a => { captured = a; }}
			/>);
			expect(captured).toEqual(actionsV0);

			currentActions = actionsV1;
			rerender(<UseMenuActionsHarness
				menu={{ current: mockMenu, version: 1 }}
				onActions={a => { captured = a; }}
			/>);
			expect(captured).toEqual(actionsV1);
		});
	});

	describe('composed with useMenu', () => {
		let contextKeyService: MockContextKeyService;
		let menuActions: Actions;
		let onDidChange: Emitter<IMenuChangeEvent>;

		beforeEach(() => {
			contextKeyService = disposables.add(new MockContextKeyService());
			menuActions = [];
			onDidChange = disposables.add(new Emitter<IMenuChangeEvent>());
		});

		/** Tracks all menus created by the mock service. */
		let createdMenus: { menu: IMenu; dispose: sinon.SinonSpy }[];

		function createServices(): PositronReactServices {
			createdMenus = [];
			const menuService: IMenuService = {
				_serviceBrand: undefined,
				createMenu: () => {
					const dispose = sinon.spy();
					const menu: IMenu = {
						onDidChange: onDidChange.event,
						dispose,
						getActions: () => menuActions,
					};
					createdMenus.push({ menu, dispose });
					return menu;
				},
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

		it('resolves actions in the same render as useMenu', () => {
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

			// RTL's act() batches effects, so the menu is created and actions
			// resolved in a single render pass.
			rtl.render(element);
			expect(captured).toEqual([['g', [action('a1')]]]);
		});

		it('updates actions when menu fires onDidChange', () => {
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

			const { rerender } = rtl.render(element);
			expect(captured).toEqual([['g', [action('v0')]]]);

			// Simulate menu content change
			menuActions = [['g', [action('v1')]]];
			onDidChange.fire({} as IMenuChangeEvent);

			// One rerender to pick up the version bump
			rerender(element);
			expect(captured).toEqual([['g', [action('v1')]]]);
		});

		it('clears actions when contextKeyService becomes undefined', () => {
			menuActions = [['g', [action('a1')]]];
			let captured: Actions = [];
			const services = createServices();

			const { rerender } = rtl.render(
				<PositronReactServicesContext.Provider value={services}>
					<ComposedHarness
						contextKeyService={contextKeyService}
						onActions={a => { captured = a; }}
					/>
				</PositronReactServicesContext.Provider>
			);
			expect(captured).toEqual([['g', [action('a1')]]]);

			// Remove contextKeyService -- actions must clear synchronously
			rerender(
				<PositronReactServicesContext.Provider value={services}>
					<ComposedHarness
						contextKeyService={undefined}
						onActions={a => { captured = a; }}
					/>
				</PositronReactServicesContext.Provider>
			);
			expect(captured).toEqual([]);
		});

		it('clears stale actions and disposes old menu on contextKeyService identity swap', () => {
			menuActions = [['g', [action('a1')]]];
			let captured: Actions = [];
			const services = createServices();

			const serviceA = contextKeyService;
			const serviceB = disposables.add(new MockContextKeyService());

			// Mount with service A and settle
			const { rerender } = rtl.render(
				<PositronReactServicesContext.Provider value={services}>
					<ComposedHarness
						contextKeyService={serviceA}
						onActions={a => { captured = a; }}
					/>
				</PositronReactServicesContext.Provider>
			);
			expect(captured).toEqual([['g', [action('a1')]]]);
			expect(createdMenus.length).toBe(1);

			// Swap to service B -- rerender triggers the effect cleanup
			// (disposing old menu) and creates a new menu in the same pass.
			rerender(
				<PositronReactServicesContext.Provider value={services}>
					<ComposedHarness
						contextKeyService={serviceB}
						onActions={a => { captured = a; }}
					/>
				</PositronReactServicesContext.Provider>
			);
			expect(captured).toEqual([['g', [action('a1')]]]);
			expect(createdMenus.length).toBe(2);
			sinon.assert.calledOnce(createdMenus[0].dispose);
		});
	});
});
