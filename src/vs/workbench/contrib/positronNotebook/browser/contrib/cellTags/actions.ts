/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../../../base/common/async.js';
import { localize, localize2 } from '../../../../../../nls.js';
import { MenuId, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { POSITRON_NOTEBOOK_CATEGORY, POSITRON_NOTEBOOK_EDITOR_ID, PositronNotebookCellActionGroup } from '../../../common/positronNotebookCommon.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { getActiveCell } from '../../selectionMachine.js';

// Add Tag - opens the inline tag input on the active cell by flipping the cell's
// isAddingTag signal (the tag bar reacts by showing a focused input). This is the
// entry point for the first tag; once a cell has tags, the bar's hover add pill
// adds further tags.
export class AddTagAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.addTag',
			title: localize2('positronNotebook.cell.addTag', "Add Tag"),
			category: POSITRON_NOTEBOOK_CATEGORY,
			f1: true,
			// Don't refocus the cell before running -- we're about to open the inline
			// tag input and want it to keep focus.
			grabFocusOnRun: false,
			// Gate on the active editor, not editor focus: right-clicking rendered
			// markdown content doesn't move DOM focus into the notebook container,
			// so a focus-based precondition would show these disabled in the
			// markdown cell context menu.
			precondition: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
			menu: [{
				// The cell action bar "..." submenu -- the only general cell menu
				// available on code cells (their right-click menu is output-only).
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Tags,
			}, {
				// Right-click menu -- currently wired up on markdown cells.
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Tags,
			}]
		});
	}

	override async runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
		const notificationService = accessor.get(INotificationService);

		const state = notebook.selectionStateMachine.state.get();
		// Every selection state except NoCells has an active cell, and NoCells has
		// no selection either, so the active cell is the only target to consider.
		const cell = getActiveCell(state);
		if (!cell) {
			notificationService.info(
				localize('positron.notebook.cellTag.noCell', "Select a cell to add a tag.")
			);
			return;
		}

		// The menu/palette that launched this command is still closing and will
		// restore focus to the notebook cell. Wait a tick so that happens first,
		// otherwise the cell refocus would steal focus from the inline tag input we
		// are about to open (blur-committing it as empty before the user types).
		await timeout(0);
		cell.beginAddTag();
	}
}
registerAction2(AddTagAction);

// Toggle Cell Tag Visibility - hides or shows all cell tags across the notebook.
// Transient per-notebook view state (see IPositronNotebookInstance.cellTagsHidden);
// not persisted, so reopening the notebook shows tags again.
export class ToggleCellTagsAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.toggleCellTags',
			title: localize2('positronNotebook.toggleCellTags', "Toggle Cell Tag Visibility"),
			category: POSITRON_NOTEBOOK_CATEGORY,
			f1: true,
			precondition: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Tags,
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Tags,
			}]
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance) {
		notebook.toggleCellTagsHidden();
	}
}
registerAction2(ToggleCellTagsAction);

// Remove All Cell Tags - clears every tag from every cell in the notebook in a
// single undoable edit.
export class RemoveAllCellTagsAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.removeAllCellTags',
			title: localize2('positronNotebook.removeAllCellTags', "Remove All Cell Tags"),
			category: POSITRON_NOTEBOOK_CATEGORY,
			f1: true,
			precondition: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Tags,
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Tags,
			}]
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance) {
		notebook.removeAllCellTags();
	}
}
registerAction2(RemoveAllCellTagsAction);
