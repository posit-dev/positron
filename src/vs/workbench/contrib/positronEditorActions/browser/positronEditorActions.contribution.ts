/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ResourceContextKey } from '../../../common/contextkeys.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
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
//
// Exported so the regression test in this contrib can reference the same
// precondition the production menu uses. Not part of any public API.
export const PositronActiveEditorIsDirtyContext = new RawContextKey<boolean>(
	'positronActiveEditorIsDirty',
	false,
	localize('positronActiveEditorIsDirty', "Whether the active editor has unsaved changes (ignores in-flight auto-save)"),
);

// Tracks isDirty() on the globally-active editor and reflects it in the
// context key above. The single Save button on each editor action bar reads
// this key via the editor pane's scoped context key service (cascades up to
// the root CKS, where this tracker binds the key).
//
// This follows the same scope semantics as the legacy top-action-bar Save
// button, which read its precondition from the global services.contextKeyService.
class PositronActiveEditorDirtyTracker extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronActiveEditorDirtyTracker';

	private readonly _activeEditorDirtyListener = this._register(new MutableDisposable());

	constructor(
		@IEditorService editorService: IEditorService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		const isDirtyKey = PositronActiveEditorIsDirtyContext.bindTo(contextKeyService);

		const refresh = () => {
			const activeEditor = editorService.activeEditor;
			isDirtyKey.set(!!activeEditor?.isDirty());
			this._activeEditorDirtyListener.value = activeEditor?.onDidChangeDirty(() => {
				isDirtyKey.set(!!activeEditor.isDirty());
			});
		};

		refresh();
		this._register(editorService.onDidActiveEditorChange(refresh));
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
		precondition: PositronActiveEditorIsDirtyContext,
	},
	group: '1_save',
	order: 10,
	when: ResourceContextKey.IsFileSystemResource,
});

registerWorkbenchContribution2(
	PositronActiveEditorDirtyTracker.ID,
	PositronActiveEditorDirtyTracker,
	WorkbenchPhase.BlockRestore,
);
