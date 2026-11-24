/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { isIMenuItem, isISubmenuItem, MenuId, MenuRegistry, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { IContext } from '../../../../../platform/contextkey/common/contextkey.js';
import { POSITRON_PLOTS_EDITOR_DYNAMIC_PLOT } from '../../../positronPlotsEditor/browser/positronPlotsEditor.js';
import { PositronPlotsEditorInput } from '../../../positronPlotsEditor/browser/positronPlotsEditorInput.js';
import { PlotsActiveEditorCopyAction, PlotsActiveEditorCopyAtCustomSizeAction } from '../../browser/positronPlotsActions.js';

describe('Editor plot tab Copy button', () => {
	const store = new DisposableStore();

	beforeAll(() => {
		store.add(registerAction2(PlotsActiveEditorCopyAction));
		store.add(registerAction2(PlotsActiveEditorCopyAtCustomSizeAction));
		store.add(MenuRegistry.appendMenuItem(MenuId.EditorActionsLeft, PlotsActiveEditorCopyAction.SUBMENU_ITEM));
	});

	afterAll(() => store.dispose());

	function plotEditorContext(dynamic: boolean): IContext {
		const values: Record<string, unknown> = {
			activeEditor: PositronPlotsEditorInput.EditorID,
			[POSITRON_PLOTS_EDITOR_DYNAMIC_PLOT.key]: dynamic,
		};
		return { getValue: <T>(key: string) => values[key] as T };
	}

	function toolbarEntries(dynamic: boolean) {
		const context = plotEditorContext(dynamic);
		return MenuRegistry.getMenuItems(MenuId.EditorActionsLeft).filter(item => item.when?.evaluate(context) ?? true);
	}

	function submenuEntries(dynamic: boolean) {
		const context = plotEditorContext(dynamic);
		return MenuRegistry.getMenuItems(PlotsActiveEditorCopyAction.SUBMENU_ID)
			.filter(item => item.when?.evaluate(context) ?? true)
			.map(item => isIMenuItem(item) ? item.command.id : undefined);
	}

	it('shows a static plot one plain Copy button', () => {
		const entries = toolbarEntries(false);
		expect(entries).toHaveLength(1);
		expect(isIMenuItem(entries[0]) && entries[0].command.id).toBe(PlotsActiveEditorCopyAction.ID);
	});

	it('shows a dynamic plot only the split Copy button', () => {
		const entries = toolbarEntries(true);
		expect(entries).toHaveLength(1);
		expect(isISubmenuItem(entries[0]) && entries[0].isSplitButton).toBe(true);
		expect(submenuEntries(true)).toEqual([PlotsActiveEditorCopyAction.ID, PlotsActiveEditorCopyAtCustomSizeAction.ID]);
	});
});
