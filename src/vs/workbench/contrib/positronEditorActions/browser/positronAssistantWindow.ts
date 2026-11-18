/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveWindow } from '../../../../base/browser/dom.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { prepareMoveCopyEditors } from '../../../browser/parts/editor/editor.js';
import { assistantWindowOptions, isAssistantWindowEditor } from '../../../browser/parts/editor/positronAuxiliaryWindowOptions.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { GroupModelChangeKind } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { editorGroupToColumn } from '../../../services/editor/common/editorGroupColumn.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';

/**
 * Cross-repo contract (see ../README.md): Posit Assistant calls this to put a window panel in
 * its own window.
 */
export const ASSISTANT_WINDOW_ENTER_COMMAND_ID = 'positron.assistantWindow.enter';

/**
 * Cross-repo contract (see ../README.md): Posit Assistant calls this to open an empty Assistant
 * window first, so it can create its panel straight in it instead of moving it there.
 */
export const ASSISTANT_WINDOW_OPEN_COMMAND_ID = 'positron.assistantWindow.open';

/**
 * Whether a group is in a dedicated Assistant window: a locked-compact auxiliary window where any
 * group holds an Assistant window panel (other than `ignore`). Checks the whole window, since an
 * "open to the side" adds a second group next to the panel's. Canvas windows are locked-compact
 * too, but hold a Canvas panel.
 */
function isInAssistantWindow(group: IEditorGroup, editorGroupsService: IEditorGroupsService, auxiliaryWindowService: IAuxiliaryWindowService, ignore?: EditorInput): boolean {
	const part = editorGroupsService.getPart(group);
	if (part === editorGroupsService.mainPart) {
		return false;
	}
	if (!part.groups.some(g => g.editors.some(editor => editor !== ignore && isAssistantWindowEditor(editor)))) {
		return false;
	}
	return auxiliaryWindowService.getWindow(part.windowId)?.createState().lockCompact === true;
}

/**
 * Opens an empty dedicated Assistant window and resolves its editor column (as an extension's
 * `ViewColumn`), for Assistant to create its window panel in. The group is locked at once: opening
 * into an explicit column still works, but stray "active group" opens go elsewhere. Assistant only
 * calls this when it's about to create a panel; a panel created there needs no `enter`.
 */
CommandsRegistry.registerCommand(ASSISTANT_WINDOW_OPEN_COMMAND_ID, async (accessor: ServicesAccessor): Promise<number> => {
	const editorGroupsService = accessor.get(IEditorGroupsService);

	const part = await editorGroupsService.createAuxiliaryEditorPart(assistantWindowOptions(getActiveWindow()));
	part.activeGroup.lock(true);
	part.activeGroup.focus();
	return editorGroupToColumn(editorGroupsService, part.activeGroup) + 1; // ViewColumn.One is column 0
});

/**
 * Moves the active editor, which must be an Assistant window panel, into a dedicated Assistant
 * window: compact for good, with its group locked so editors opened "in the active group" go
 * elsewhere. Not in the palette; Assistant makes the panel active first. Resolves `true` when the
 * panel is in a dedicated window afterwards, including one it was created in from `open`.
 */
CommandsRegistry.registerCommand(ASSISTANT_WINDOW_ENTER_COMMAND_ID, async (accessor: ServicesAccessor): Promise<boolean> => {
	const editorGroupsService = accessor.get(IEditorGroupsService);
	const auxiliaryWindowService = accessor.get(IAuxiliaryWindowService);

	const sourceGroup = editorGroupsService.activeGroup;
	const editor = sourceGroup.activeEditor;
	if (!editor || !isAssistantWindowEditor(editor)) {
		return false;
	}
	if (isInAssistantWindow(sourceGroup, editorGroupsService, auxiliaryWindowService)) {
		sourceGroup.focus();
		return true; // already there
	}

	// The source window is still the active window at this point.
	const part = await editorGroupsService.createAuxiliaryEditorPart(assistantWindowOptions(getActiveWindow()));
	if (!sourceGroup.moveEditors(prepareMoveCopyEditors(sourceGroup, [editor]), part.activeGroup)) {
		part.close(); // empty, so this closes the window too
		return false;
	}
	part.activeGroup.lock(true);
	part.activeGroup.focus();
	return true;
});

/**
 * Keeps a dedicated Assistant window to its one panel. The group lock only stops editors opened
 * "in the active group"; one opened in the window's column or to its side, dropped onto it, or
 * opened by another extension would sit hidden in a window with no tabs. Those move to the main
 * window.
 */
export class AssistantWindowGuard extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positronAssistantWindowGuard';

	private readonly groupListeners = this._register(new DisposableMap<IEditorGroup, DisposableStore>());

	constructor(
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IAuxiliaryWindowService private readonly auxiliaryWindowService: IAuxiliaryWindowService,
	) {
		super();

		for (const group of editorGroupsService.groups) {
			this.watchGroup(group);
		}
		this._register(editorGroupsService.onDidAddGroup(group => this.watchGroup(group)));
		this._register(editorGroupsService.onDidRemoveGroup(group => this.groupListeners.deleteAndDispose(group)));
	}

	private watchGroup(group: IEditorGroup): void {
		const store = new DisposableStore();
		store.add(group.onDidModelChange(e => {
			const editor = e.editor;
			if (e.kind !== GroupModelChangeKind.EDITOR_OPEN || !editor) {
				return;
			}
			if (!isInAssistantWindow(group, this.editorGroupsService, this.auxiliaryWindowService, editor)) {
				return;
			}
			// Let the open finish before moving the editor out again.
			disposableTimeout(() => {
				if (group.contains(editor)) {
					group.moveEditor(editor, this.editorGroupsService.mainPart.activeGroup);
				}
			}, 0, store);
		}));
		this.groupListeners.set(group, store);
	}
}
