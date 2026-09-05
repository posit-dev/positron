/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { MenuId, MenuItemAction, MenuRegistry } from '../../common/actions.js';
import { MenuService } from '../../common/menuService.js';
import { NullCommandService } from '../../../commands/test/common/nullCommandService.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../contextkey/browser/contextKeyService.js';
import { ContextKeyExpr, RawContextKey } from '../../../contextkey/common/contextkey.js';
import { MockKeybindingService } from '../../../keybinding/test/common/mockKeybindingService.js';
import { InMemoryStorageService } from '../../../storage/common/storage.js';
import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';

// A Positron action bar checkbox or toggle keeps its state in its own context key expression,
// which the menu has to treat the same way it treats `toggled`: evaluate it onto the action, and
// raise a change event when a key it names changes. A real ContextKeyService is essential here --
// MockContextKeyService's onDidChangeContext is Event.None, so nothing would ever fire.
describe('MenuService, Positron action bar control state', () => {
	const disposables = ensureNoLeakedDisposables();

	const setup = (positronActionBarOptions: MenuItemAction['positronActionBarOptions']) => {
		const contextKeyService = disposables.add(new ContextKeyService(new TestConfigurationService()));
		const menuService = disposables.add(new MenuService(
			NullCommandService,
			new MockKeybindingService(),
			disposables.add(new InMemoryStorageService())
		));

		const menuId = new MenuId(`test/${generateUuid()}`);
		disposables.add(MenuRegistry.appendMenuItem(menuId, {
			command: {
				id: 'test.renderOnSave',
				title: 'Render on Save',
				positronActionBarOptions
			}
		}));

		const menu = disposables.add(menuService.createMenu(menuId, contextKeyService, { eventDebounceDelay: 0 }));
		return {
			contextKeyService,
			menu,
			// The action is rebuilt on every call, which is what the action bar does when the menu
			// tells it something changed.
			action: () => menu.getActions()[0][1][0] as MenuItemAction
		};
	};

	it('reports a checkbox as checked when its expression matches', async () => {
		const { contextKeyService, menu, action } = setup({
			controlType: 'checkbox',
			checked: ContextKeyExpr.has('test.renderOnSave')
		});
		const renderOnSave = new RawContextKey<boolean>('test.renderOnSave', false).bindTo(contextKeyService);

		expect(action().checked).toBe(false);

		const changed = Event.toPromise(menu.onDidChange);
		renderOnSave.set(true);

		expect((await changed).isToggleChange).toBe(true);
		expect(action().checked).toBe(true);
	});

	it('reports a toggle the same way, from its toggled expression', async () => {
		const { contextKeyService, menu, action } = setup({
			controlType: 'toggle',
			toggled: ContextKeyExpr.equals('test.editMode', 'visual'),
			leftTitle: 'Source',
			rightTitle: 'Visual'
		});
		const editMode = new RawContextKey<string>('test.editMode', 'source').bindTo(contextKeyService);

		expect(action().checked).toBe(false);

		const changed = Event.toPromise(menu.onDidChange);
		editMode.set('visual');

		expect((await changed).isToggleChange).toBe(true);
		expect(action().checked).toBe(true);
	});

	it('leaves checked undefined for a control with no state of its own', () => {
		const { action } = setup({ controlType: 'button', displayTitle: true });

		expect(action().checked).toBeUndefined();
	});
});
