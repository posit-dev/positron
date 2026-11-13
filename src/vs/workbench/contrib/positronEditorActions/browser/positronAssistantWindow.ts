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
import { IAuxiliaryEditorPart, IEditorGroup, IEditorGroupsService, IEditorPart } from '../../../services/editor/common/editorGroupsService.js';

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

/** How long an opened window waits for its panel before closing itself. */
const PENDING_WINDOW_TIMEOUT_MS = 15_000;

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
 * The empty window from the last `open`, until a panel arrives in it, `enter` uses or discards it,
 * or it times out. One at a time: Assistant runs one "Open in New Window" at a time.
 */
let pendingWindow: { readonly part: IAuxiliaryEditorPart; readonly cleanup: DisposableStore } | undefined;

/** Clears the pending window, closing it unless it's `keep` or no longer empty. */
function settlePendingWindow(keep?: IEditorPart): void {
	const pending = pendingWindow;
	if (!pending) {
		return;
	}
	pendingWindow = undefined;
	pending.cleanup.dispose();
	if (pending.part !== keep && pending.part.groups.every(group => group.isEmpty)) {
		pending.part.close();
	}
}

/**
 * Opens an empty dedicated Assistant window and resolves its editor column (as an extension's
 * `ViewColumn`), for Assistant to create its window panel in. The group is locked at once: opening
 * into an explicit column still works, but stray "active group" opens go elsewhere. Assistant
 * calls `enter` once the panel is there; if no panel arrives, the window closes itself.
 */
CommandsRegistry.registerCommand(ASSISTANT_WINDOW_OPEN_COMMAND_ID, async (accessor: ServicesAccessor): Promise<number> => {
	const editorGroupsService = accessor.get(IEditorGroupsService);

	settlePendingWindow();
	const part = await editorGroupsService.createAuxiliaryEditorPart(assistantWindowOptions(getActiveWindow()));
	part.activeGroup.lock(true);
	part.activeGroup.focus();

	const cleanup = new DisposableStore();
	cleanup.add(part.onWillDispose(() => {
		if (pendingWindow?.part === part) {
			pendingWindow = undefined;
			cleanup.dispose();
		}
	}));
	cleanup.add(disposableTimeout(() => {
		if (pendingWindow?.part === part) {
			settlePendingWindow();
		}
	}, PENDING_WINDOW_TIMEOUT_MS));
	pendingWindow = { part, cleanup };

	return editorGroupToColumn(editorGroupsService, part.activeGroup) + 1; // ViewColumn.One is column 0
});

/**
 * Moves the active editor, which must be an Assistant window panel, into a dedicated Assistant
 * window: compact for good, with its group locked so editors opened "in the active group" go
 * elsewhere. Uses the window from `open` when there is one. Not in the palette; Assistant makes
 * the panel active first. Resolves `true` when the panel is in a dedicated window afterwards.
 */
CommandsRegistry.registerCommand(ASSISTANT_WINDOW_ENTER_COMMAND_ID, async (accessor: ServicesAccessor): Promise<boolean> => {
	const editorGroupsService = accessor.get(IEditorGroupsService);
	const auxiliaryWindowService = accessor.get(IAuxiliaryWindowService);

	const sourceGroup = editorGroupsService.activeGroup;
	const editor = sourceGroup.activeEditor;
	if (!editor || !isAssistantWindowEditor(editor)) {
		settlePendingWindow();
		return false;
	}
	if (isInAssistantWindow(sourceGroup, editorGroupsService, auxiliaryWindowService)) {
		// Created straight in the window from `open`, or already moved there earlier.
		settlePendingWindow(editorGroupsService.getPart(sourceGroup));
		sourceGroup.lock(true);
		sourceGroup.focus();
		return true;
	}

	// The panel opened in the main window (focus moved, or Assistant reused a panel): move it.
	const pending = pendingWindow?.part.activeGroup.isEmpty ? pendingWindow.part : undefined;
	settlePendingWindow(pending);
	// The source window is still the active window at this point.
	const part = pending ?? await editorGroupsService.createAuxiliaryEditorPart(assistantWindowOptions(getActiveWindow()));
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
