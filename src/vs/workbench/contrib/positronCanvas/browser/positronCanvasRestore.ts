/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { prepareMoveCopyEditors } from '../../../browser/parts/editor/editor.js';
import { IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { GroupsOrder, IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { CANVAS_WEBVIEW_VIEW_TYPE } from '../common/positronCanvasMode.js';

/**
 * Returns a Canvas group's editors to an ordinary IDE group. Merge, never
 * `close()`: close treats a webview panel as non-confirming and destroys it,
 * dropping the live conversation.
 */
export function mergeCanvasGroupIntoIde(group: IEditorGroup, target: IEditorGroup, editorGroupsService: IEditorGroupsService, logService: ILogService): void {
	// Unlock so the group is an ordinary group for as long as it survives
	// the merge.
	group.lock(false);
	if (!editorGroupsService.mergeGroup(group, target)) {
		logService.error('[canvas] Could not merge the Canvas group into the IDE; moving its editors individually');
		group.moveEditors(prepareMoveCopyEditors(group, group.editors.slice()), target);
	}
}

/**
 * Holds (see `IPositronCanvasService.holdRestoredWindow`) every auxiliary
 * window opened from now until layout restore completes: exactly the windows
 * `EditorParts.restoreState` brings back, which appear natively visible
 * while the startup curtain covers only the main window. Stops listening at
 * `whenRestored`, before Canvas entry may open a window of its own, and on
 * dispose. Call from the Canvas startup boot before restore begins.
 */
export function holdRestoredAuxiliaryWindows(
	auxiliaryWindowService: Pick<IAuxiliaryWindowService, 'onDidOpenAuxiliaryWindow'>,
	editorGroupsService: Pick<IEditorGroupsService, 'whenRestored'>,
	hold: (windowId: number) => Promise<void>,
	logService: ILogService
): IDisposable {
	const disposables = new DisposableStore();
	disposables.add(auxiliaryWindowService.onDidOpenAuxiliaryWindow(({ window }) => {
		hold(window.window.vscodeWindowId).catch(error => logService.error('[canvas] Could not hold a restored window', error));
	}));
	editorGroupsService.whenRestored.then(() => disposables.dispose(), () => disposables.dispose());
	return disposables;
}

export interface ICanvasRestoreSweepServices {
	readonly auxiliaryWindowService: IAuxiliaryWindowService;
	readonly editorGroupsService: IEditorGroupsService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly logService: ILogService;
}

/**
 * A window not presenting Canvas must not sit next to a dedicated Canvas
 * window. Layout restore no longer brings one back
 * (positronEditorPartsRestore.ts); this catches any other that outlived
 * Canvas mode. Merge its Canvas back into the IDE as an inline tab (the
 * conversation survives; the emptied window closes itself). Recognized by
 * the `lockCompact` trait, which only Canvas mode sets; a Canvas the user
 * popped out by hand lacks it and is left alone. Idempotent.
 */
export async function sweepRestoredCanvasWindows(services: ICanvasRestoreSweepServices): Promise<void> {
	const { auxiliaryWindowService, editorGroupsService, layoutService, logService } = services;

	await editorGroupsService.whenRestored;

	let merged = false;
	for (const part of editorGroupsService.parts) {
		if (part === editorGroupsService.mainPart) {
			continue;
		}
		if (auxiliaryWindowService.getWindow(part.windowId)?.createState().lockCompact !== true) {
			continue;
		}
		const groups = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		const editors = groups.flatMap(group => group.editors);
		if (editors.length === 0 || !editors.every(editor => editor instanceof WebviewInput && editor.providerId === CANVAS_WEBVIEW_VIEW_TYPE)) {
			continue;
		}
		logService.info('[canvas] Merging a restored Canvas window back into the IDE: Canvas mode is not presenting it');
		for (const group of groups) {
			mergeCanvasGroupIntoIde(group, editorGroupsService.mainPart.activeGroup, editorGroupsService, logService);
		}
		merged = true;
	}

	if (merged) {
		// A merge into an auto-hidden editor area would leave the Canvas tab
		// invisible.
		layoutService.setPartHidden(false, Parts.EDITOR_PART);
	}
}
