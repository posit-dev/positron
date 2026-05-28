/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// Regression coverage for https://github.com/posit-dev/positron/issues/13530.
//
// The original contribution used `precondition: ActiveEditorDirtyContext` for
// the editor-action-bar Save button. editorGroupView sets that context as
// `isDirty() && !isSaving()`. On Web the default auto-save mode is
// `afterDelay`, so FileEditorInput.isSaving() returns true for any dirty file
// with a short auto-save delay -- the conjunction pins false even after the
// user types, and the Save button never enables.
//
// The fix introduces `PositronActiveEditorIsDirty`, tracked by a workbench
// contribution that reflects `isDirty()` alone. These tests open the menu
// registered by the production contribution, drive that key directly, and
// assert the Save action's enabled state follows it. The tests bypass the
// tracker class -- a bug there (e.g. it never subscribes to onDidChangeDirty)
// would not be caught here.

import { Event } from '../../../../../base/common/event.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { NullCommandService } from '../../../../../platform/commands/test/common/nullCommandService.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IStorageService, InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { IMenu, IMenuService, MenuId, MenuItemAction } from '../../../../../platform/actions/common/actions.js';
import { MenuService } from '../../../../../platform/actions/common/menuService.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
// Named-importing the contribution also runs its top-level menu registration,
// so the menu items are available on MenuRegistry by the time the tests run.
import { PositronActiveEditorIsDirtyContext } from '../../browser/positronEditorActions.contribution.js';

const SAVE_FILE_COMMAND_ID = 'workbench.action.files.save';

function getSaveAction(menu: IMenu): MenuItemAction | undefined {
	for (const [, actions] of menu.getActions({ shouldForwardArgs: true })) {
		for (const action of actions) {
			if (action.id === SAVE_FILE_COMMAND_ID && action instanceof MenuItemAction) {
				return action;
			}
		}
	}
	return undefined;
}

describe('positronEditorActions.contribution save button (regression for #13530)', () => {
	const disposables = ensureNoLeakedDisposables();
	let menuService: IMenuService;
	let groupContextKeyService: IContextKeyService;
	let editorPaneContextKeyService: IContextKeyService;

	beforeEach(() => {
		// Mirror the production CKS hierarchy: root -> group -> editor pane.
		const root = disposables.add(new ContextKeyService(new TestConfigurationService()));
		groupContextKeyService = disposables.add(root.createScoped(document.createElement('div')));
		editorPaneContextKeyService = disposables.add(groupContextKeyService.createScoped(document.createElement('div')));

		// MenuService doesn't implement IDisposable, but it owns a
		// PersistedMenuHideState that registers a storage listener disposable.
		// Wrap it so the leak detector sees the disposal.
		const ms = new MenuService(
			NullCommandService as ICommandService,
			new MockKeybindingService() as IKeybindingService,
			disposables.add(new InMemoryStorageService()) as IStorageService,
		);
		disposables.add({ dispose: () => (ms as unknown as { _hiddenStates: { dispose(): void } })._hiddenStates.dispose() });
		menuService = ms;

		// The Save menu item is gated by `when: ResourceContextKey.IsFileSystemResource`.
		// Setting just that single key directly is simpler than constructing a
		// full ResourceContextKey (which pulls in IFileService / IModelService).
		new RawContextKey<boolean>('isFileSystemResource', false).bindTo(groupContextKeyService).set(true);
	});

	it('Save action is disabled when the active editor is clean', () => {
		PositronActiveEditorIsDirtyContext.bindTo(groupContextKeyService).set(false);

		const menu = disposables.add(menuService.createMenu(MenuId.EditorActionsLeft, editorPaneContextKeyService, { eventDebounceDelay: 0, emitEventsForSubmenuChanges: true }));

		expect(getSaveAction(menu)?.enabled).toBe(false);
	});

	it('Save action enables when the editor is dirty (even while auto-save is in flight)', () => {
		// The Web auto-save scenario from #13530: the user has just typed, so
		// the editor is dirty AND a save is about to fire. The fixed
		// precondition is isDirty()-only, so the action must enable.
		PositronActiveEditorIsDirtyContext.bindTo(groupContextKeyService).set(true);

		const menu = disposables.add(menuService.createMenu(MenuId.EditorActionsLeft, editorPaneContextKeyService, { eventDebounceDelay: 0, emitEventsForSubmenuChanges: true }));

		expect(getSaveAction(menu)?.enabled).toBe(true);
	});

	it('Save action toggles disabled again when the editor becomes clean', async () => {
		const dirtyKey = PositronActiveEditorIsDirtyContext.bindTo(groupContextKeyService);
		dirtyKey.set(true);

		const menu = disposables.add(menuService.createMenu(MenuId.EditorActionsLeft, editorPaneContextKeyService, { eventDebounceDelay: 0, emitEventsForSubmenuChanges: true }));
		expect(getSaveAction(menu)?.enabled).toBe(true);

		// Subscribe before firing so MenuImpl's lazy listener is attached --
		// then drain the DebounceEmitter on `onDidChange` after flipping.
		const onceChanged = Event.toPromise(menu.onDidChange);
		dirtyKey.set(false);
		await onceChanged;

		expect(getSaveAction(menu)?.enabled).toBe(false);
	});
});
