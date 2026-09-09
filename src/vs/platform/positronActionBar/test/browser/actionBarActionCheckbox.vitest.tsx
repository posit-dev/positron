/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ActionBarActionCheckbox } from '../../browser/components/actionBarActionCheckbox.js';
import { MenuId, MenuItemAction, MenuRegistry } from '../../../actions/common/actions.js';
import { PositronActionBarOptions } from '../../../action/common/action.js';
import { MenuService } from '../../../actions/common/menuService.js';
import { NullCommandService } from '../../../commands/test/common/nullCommandService.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../contextkey/browser/contextKeyService.js';
import { ContextKeyExpr, RawContextKey } from '../../../contextkey/common/contextkey.js';
import { MockKeybindingService } from '../../../keybinding/test/common/mockKeybindingService.js';
import { InMemoryStorageService } from '../../../storage/common/storage.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { setupRTLRenderer } from '../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../test/vitest/positronTestContainer.js';

// The wrapper reads a real MenuItemAction and decides whether, and with what state, to render the
// low-level ActionBarCheckbox (already covered by actionBarCheckbox.vitest.tsx). A real
// ContextKeyService is used to build that action, the same way menuService.vitest.ts does, because
// `checked` is evaluated once at construction from the live context.
describe('ActionBarActionCheckbox', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let disposables: DisposableStore;
	beforeEach(() => {
		disposables = new DisposableStore();
	});
	afterEach(() => {
		disposables.dispose();
	});

	const createAction = (overrides?: {
		checked?: boolean;
		enabled?: boolean;
		positronActionBarOptions?: PositronActionBarOptions;
	}): MenuItemAction => {
		const contextKeyService = disposables.add(new ContextKeyService(new TestConfigurationService()));
		new RawContextKey<boolean>('test.renderOnSave', overrides?.checked ?? false).bindTo(contextKeyService);
		new RawContextKey<boolean>('test.renderOnSaveEnabled', overrides?.enabled ?? true).bindTo(contextKeyService);

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
				precondition: ContextKeyExpr.has('test.renderOnSaveEnabled'),
				positronActionBarOptions: overrides?.positronActionBarOptions ?? {
					controlType: 'checkbox',
					checked: ContextKeyExpr.has('test.renderOnSave')
				}
			}
		}));

		const menu = disposables.add(menuService.createMenu(menuId, contextKeyService, { eventDebounceDelay: 0 }));
		return menu.getActions()[0][1][0] as MenuItemAction;
	};

	const renderCheckbox = (action = createAction()) => {
		rtl.render(<ActionBarActionCheckbox action={action} />);
		return action;
	};

	it('uses the action label as its accessible name and reports the action checked state', () => {
		renderCheckbox(createAction({ checked: true }));

		const checkbox = screen.getByRole('checkbox');
		expect(checkbox).toHaveAccessibleName('Render on Save');
		expect(checkbox).toBeChecked();
	});

	it('runs the action through the command service when activated', async () => {
		const user = userEvent.setup();
		const executeCommand = vi.spyOn(NullCommandService, 'executeCommand');
		const action = renderCheckbox(createAction());

		await user.click(screen.getByRole('checkbox'));

		expect(executeCommand).toHaveBeenCalledWith(action.id);
	});

	it('disables the checkbox when its action is disabled', async () => {
		const user = userEvent.setup();
		const executeCommand = vi.spyOn(NullCommandService, 'executeCommand');
		renderCheckbox(createAction({ enabled: false }));
		const checkbox = screen.getByRole('checkbox');

		expect(checkbox).toBeDisabled();

		await user.click(checkbox);
		expect(executeCommand).not.toHaveBeenCalled();
	});
});
