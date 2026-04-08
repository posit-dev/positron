/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../base/test/browser/react.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IMenu, IMenuService, MenuId } from '../../../../../platform/actions/common/actions.js';
import { PositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IVersionedMenu, useMenu } from '../../browser/useMenu.js';

/**
 * Test harness that renders useMenu and exposes its return value.
 */
function UseMenuHarness({ contextKeyService, onMenu }: {
	contextKeyService: IContextKeyService | undefined;
	onMenu: (menu: IVersionedMenu) => void;
}) {
	const menu = useMenu(MenuId.CommandPalette, contextKeyService);
	onMenu(menu);
	return null;
}

suite('useMenu', () => {
	const { render } = setupReactRenderer();
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let contextKeyService: MockContextKeyService;
	let menuService: IMenuService;

	setup(() => {
		contextKeyService = disposables.add(new MockContextKeyService());

		const menu: IMenu = {
			onDidChange: Event.None,
			dispose: () => { },
			getActions: () => [],
		};

		menuService = {
			_serviceBrand: undefined,
			createMenu: () => menu,
			getMenuActions: () => [],
			getMenuContexts: () => new Set(),
			resetHiddenStates: () => { },
		};
	});

	function createServicesProvider() {
		return {
			get: (id: any) => {
				if (id === IMenuService) { return menuService; }
				throw new Error(`Unexpected service: ${id}`);
			},
		} as unknown as PositronReactServices;
	}

	/**
	 * Renders the useMenu harness and returns the captured menu value.
	 * Renders twice to settle the useEffect that creates the menu.
	 */
	function renderHarness(service: IContextKeyService | undefined): IVersionedMenu {
		let captured: IVersionedMenu | undefined;
		const services = createServicesProvider();
		const element = (
			<PositronReactServicesContext.Provider value={services}>
				<UseMenuHarness
					contextKeyService={service}
					onMenu={(m) => { captured = m; }}
				/>
			</PositronReactServicesContext.Provider>
		);

		// Render twice: first render queues the useEffect, second settles it.
		render(element);
		render(element);
		return captured!;
	}

	test('returns undefined menu when contextKeyService is undefined', () => {
		const result = renderHarness(undefined);
		assert.strictEqual(result.current, undefined);
	});

	test('returns a menu when contextKeyService is provided', () => {
		const result = renderHarness(contextKeyService);
		assert.ok(result.current, 'menu should be created when contextKeyService is provided');
	});

	test('synchronously clears menu when contextKeyService transitions to undefined', () => {
		let captured: IVersionedMenu | undefined;
		const services = createServicesProvider();
		const onMenu = (m: IVersionedMenu) => { captured = m; };

		// Render with a valid service and settle the effect
		const withService = (
			<PositronReactServicesContext.Provider value={services}>
				<UseMenuHarness contextKeyService={contextKeyService} onMenu={onMenu} />
			</PositronReactServicesContext.Provider>
		);
		render(withService);
		render(withService);
		assert.ok(captured!.current, 'menu should be created initially');

		// Re-render with undefined -- menu must be cleared on the FIRST render
		// (synchronously), not deferred to a later effect.
		render(
			<PositronReactServicesContext.Provider value={services}>
				<UseMenuHarness contextKeyService={undefined} onMenu={onMenu} />
			</PositronReactServicesContext.Provider>
		);
		assert.strictEqual(
			captured!.current,
			undefined,
			'menu must be synchronously undefined when contextKeyService disappears'
		);
	});

	test('synchronously masks stale menu when contextKeyService identity changes', () => {
		let captured: IVersionedMenu | undefined;
		const services = createServicesProvider();
		const onMenu = (m: IVersionedMenu) => { captured = m; };

		const serviceA = contextKeyService;
		const serviceB = disposables.add(new MockContextKeyService());

		// Render with service A and settle the effect
		const withA = (
			<PositronReactServicesContext.Provider value={services}>
				<UseMenuHarness contextKeyService={serviceA} onMenu={onMenu} />
			</PositronReactServicesContext.Provider>
		);
		render(withA);
		render(withA);
		const menuA = captured!.current;
		assert.ok(menuA, 'menu should be created for service A');

		// Switch to service B on the FIRST render -- the old menu must not
		// leak through, even before the effect recreates the menu.
		render(
			<PositronReactServicesContext.Provider value={services}>
				<UseMenuHarness contextKeyService={serviceB} onMenu={onMenu} />
			</PositronReactServicesContext.Provider>
		);
		assert.strictEqual(
			captured!.current,
			undefined,
			'stale menu from service A must not be exposed when service B is active'
		);
	});
});
