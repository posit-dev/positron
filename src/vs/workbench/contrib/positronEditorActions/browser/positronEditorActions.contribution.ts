/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './positronDedicatedWindow.js';
import { localize } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ResourceContextKey } from '../../../common/contextkeys.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { SAVE_FILE_COMMAND_ID, SAVE_FILE_LABEL } from '../../files/browser/fileConstants.js';

// Save-button-only dirty context.
//
// We cannot reuse the workbench-wide `ActiveEditorDirtyContext`. That key is
// set as `isDirty() && !isSaving()` in editorGroupView so the tab-modified
// indicator can hide while an imminent auto-save is queued. On Web the
// default auto-save mode is `afterDelay`, which makes FileEditorInput.isSaving()
// true for any dirty file -- pinning `ActiveEditorDirtyContext` to false even
// after the user types (see https://github.com/posit-dev/positron/issues/13530).
// The Save button must enable on unsaved edits regardless of whether an
// auto-save is queued, so we maintain our own key.
const ActiveEditorHasUnsavedChangesContext = new RawContextKey<boolean>(
	'positronEditorActions.activeEditorHasUnsavedChanges',
	false,
	localize('positron.activeEditorHasUnsavedChanges', "Whether the active editor has unsaved changes (ignores in-flight auto-save)"),
);

// Tracks `activeEditor.isDirty()` per editor group via the editor parts
// provider API. The provider binds the context key on each group's scoped
// context key service and mirrors the active group's value into the global
// scope, so the Save button on each group's action bar reads its own group's
// dirty state (with `editorPartsView.bind` semantics, matching upstream's
// own per-group keys like ActiveEditorDirtyContext).
//
// Re-evaluations happen on:
//   - any group's active editor change (handled internally by editor parts)
//   - any working copy dirty change (provided via `onDidChange` below) --
//     this covers the user-types-into-active-editor flow because the editor
//     model is the working copy.
class ActiveEditorHasUnsavedChangesTracker extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronEditorActions.activeEditorHasUnsavedChangesTracker';

	constructor(
		@IEditorGroupsService editorGroupsService: IEditorGroupsService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
	) {
		super();

		this._register(editorGroupsService.registerContextKeyProvider({
			contextKey: ActiveEditorHasUnsavedChangesContext,
			getGroupContextKeyValue: (group: IEditorGroup) => !!group.activeEditor?.isDirty(),
			onDidChange: Event.map(workingCopyService.onDidChangeDirty, () => undefined),
		}));
	}
}

// Adds the Save File button to the editor action bar so it sits with the
// editor it acts on. Always rendered for file-backed editors (text editors,
// Quarto, Positron notebooks); precondition disables it when the active editor
// is clean.
//
// Group `1_save` (not `navigation`): the menu service special-cases
// `navigation` to render first regardless of group-name order, so Save in
// `navigation` would sit to the left of editor-specific actions like Quarto's
// `0_preview` Render buttons or the notebook's `navigation` Run / Clear / Add
// cluster. `1_save` sorts lexically after those, placing Save just to the
// right of them with a group separator between.
MenuRegistry.appendMenuItem(MenuId.EditorActionsLeft, {
	command: {
		id: SAVE_FILE_COMMAND_ID,
		title: SAVE_FILE_LABEL,
		icon: ThemeIcon.fromId('positron-save'),
		precondition: ActiveEditorHasUnsavedChangesContext,
	},
	group: '1_save',
	order: 10,
	when: ResourceContextKey.IsFileSystemResource,
});

registerWorkbenchContribution2(
	ActiveEditorHasUnsavedChangesTracker.ID,
	ActiveEditorHasUnsavedChangesTracker,
	WorkbenchPhase.BlockRestore,
);
