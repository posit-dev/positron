/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { CellContextKeys } from '../../common/cellContextKeys.js';
import { PositronNotebookActionId } from '../../common/positronNotebookCommon.js';

// Importing the contribution barrel runs its side-effect imports, which register
// the notebook cell output actions (Save Plot / Open Output in New Tab).
import '../../browser/positronNotebook.contribution.js';

/** Collect the menu items contributed for a given action id in a given menu. */
function menuItemsFor(menuId: MenuId, actionId: string) {
	return MenuRegistry.getMenuItems(menuId)
		.filter(isIMenuItem)
		.filter(item => item.command.id === actionId);
}

describe('Positron notebook plot output actions registration', () => {
	for (const { name, id } of [
		{ name: 'Save Image', id: PositronNotebookActionId.SaveOutputImage },
		{ name: 'Open Image in New Tab', id: PositronNotebookActionId.OpenOutputImageInNewTab },
	]) {
		describe(name, () => {
			it('is contributed to the output action bar with an image+expanded when clause', () => {
				const items = menuItemsFor(MenuId.PositronNotebookCellOutputActionBar, id);
				expect(items).toHaveLength(1);
				const when = items[0].when?.serialize() ?? '';
				expect(when).toContain(CellContextKeys.imageOutputCount.key);
				expect(when).toContain(CellContextKeys.outputIsCollapsed.key);
			});

			it('is contributed to the output context menu when an image is targeted', () => {
				const items = menuItemsFor(MenuId.PositronNotebookCellOutputActionContext, id);
				expect(items).toHaveLength(1);
				const when = items[0].when?.serialize() ?? '';
				expect(when).toContain(CellContextKeys.outputImageTargeted.key);
				expect(when).toContain(CellContextKeys.outputIsCollapsed.key);
			});
		});
	}
});
