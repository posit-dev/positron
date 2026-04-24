/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IMenu, IMenuChangeEvent, IMenuService, MenuId, MenuItemAction, SubmenuItemAction } from '../../../../../platform/actions/common/actions.js';
import { IVersionedMenu, useMenu } from '../../browser/useMenu.js';
import { useMenuActions } from '../../browser/useMenuActions.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

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

const action = (id: string) => stubInterface<MenuItemAction>({ id });

describe('useMenuActions', () => {
	describe('standalone', () => {
		const ctx = createTestContainer()
			.withReactServices()
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

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
				current: stubInterface<IMenu>({ getActions: () => expected }),
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

			const mockMenu = stubInterface<IMenu>({ getActions: () => currentActions });

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
		/** Tracks all menus created by the mock service. */
		let createdMenus: { menu: IMenu; dispose: ReturnType<typeof vi.fn> }[];

		const menuService: IMenuService = {
			_serviceBrand: undefined,
			createMenu: () => {
				const dispose = vi.fn();
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

		const ctx = createTestContainer()
			.withReactServices()
			.stub(IMenuService, menuService)
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		beforeEach(() => {
			contextKeyService = ctx.disposables.add(new MockContextKeyService());
			menuActions = [];
			onDidChange = ctx.disposables.add(new Emitter<IMenuChangeEvent>());
			createdMenus = [];
		});

		it('resolves actions in the same render as useMenu', () => {
			menuActions = [['g', [action('a1')]]];
			let captured: Actions = [];

			// RTL's act() batches effects, so the menu is created and actions
			// resolved in a single render pass.
			rtl.render(
				<ComposedHarness
					contextKeyService={contextKeyService}
					onActions={a => { captured = a; }}
				/>
			);
			expect(captured).toEqual([['g', [action('a1')]]]);
		});

		it('updates actions when menu fires onDidChange', () => {
			menuActions = [['g', [action('v0')]]];
			let captured: Actions = [];

			const element = (
				<ComposedHarness
					contextKeyService={contextKeyService}
					onActions={a => { captured = a; }}
				/>
			);

			const { rerender } = rtl.render(element);
			expect(captured).toEqual([['g', [action('v0')]]]);

			// act() wraps fire() because the useMenu subscriber calls setState.
			menuActions = [['g', [action('v1')]]];
			act(() => onDidChange.fire(stubInterface<IMenuChangeEvent>()));

			// One rerender to pick up the version bump
			rerender(element);
			expect(captured).toEqual([['g', [action('v1')]]]);
		});

		it('clears actions when contextKeyService becomes undefined', () => {
			menuActions = [['g', [action('a1')]]];
			let captured: Actions = [];

			const { rerender } = rtl.render(
				<ComposedHarness
					contextKeyService={contextKeyService}
					onActions={a => { captured = a; }}
				/>
			);
			expect(captured).toEqual([['g', [action('a1')]]]);

			// Remove contextKeyService -- actions must clear synchronously
			rerender(
				<ComposedHarness
					contextKeyService={undefined}
					onActions={a => { captured = a; }}
				/>
			);
			expect(captured, 'actions must clear when service disappears').toEqual([]);
		});

		it('clears stale actions and disposes old menu on contextKeyService identity swap', () => {
			menuActions = [['g', [action('a1')]]];
			let captured: Actions = [];

			const serviceA = contextKeyService;
			const serviceB = ctx.disposables.add(new MockContextKeyService());

			// Mount with service A and settle
			const { rerender } = rtl.render(
				<ComposedHarness
					contextKeyService={serviceA}
					onActions={a => { captured = a; }}
				/>
			);
			expect(captured).toEqual([['g', [action('a1')]]]);
			expect(createdMenus.length, 'one menu created for service A').toBe(1);

			// Swap to service B -- rerender triggers the effect cleanup
			// (disposing old menu) and creates a new menu in the same pass.
			rerender(
				<ComposedHarness
					contextKeyService={serviceB}
					onActions={a => { captured = a; }}
				/>
			);
			expect(captured, 'actions from service B menu').toEqual([['g', [action('a1')]]]);
			expect(createdMenus.length, 'a new menu was created for service B').toBe(2);
			expect(createdMenus[0].dispose).toHaveBeenCalledOnce();
		});
	});
});
