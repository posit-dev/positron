/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize2 } from '../../../../nls.js';
import { MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CellContextKeys } from '../common/cellContextKeys.js';
import { PositronNotebookActionId, PositronNotebookCellOutputActionGroup } from '../common/positronNotebookCommon.js';
import { copyImageToClipboard, isCopyImageMenuArg } from './copyImageUtils.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { NotebookAction2 } from './NotebookAction2.js';
import { openImageInEditorFromDataUrl, saveImageFromDataUrl } from './notebookImageOutputUtils.js';
import { getActiveCell } from './selectionMachine.js';

/**
 * Resolve the targeted image data URL and owning cell index for an image output
 * action. Prefers a forwarded `CopyImageMenuArg` (right-click on a specific
 * image), otherwise falls back to the first image output of the active cell.
 */
export function resolveImageOutputTarget(notebook: IPositronNotebookInstance, args: unknown[]): { dataUrl: string; cellIndex: number } | undefined {
	const state = notebook.selectionStateMachine.state.get();
	const cell = getActiveCell(state);
	if (!cell?.isCodeCell()) {
		return undefined;
	}

	const menuArg = args.find(isCopyImageMenuArg);
	let dataUrl = menuArg?.imageDataUrl;

	if (!dataUrl) {
		const imageOutput = cell.outputs.get().find(o => o.parsed.type === 'image');
		if (imageOutput?.parsed.type === 'image') {
			dataUrl = imageOutput.parsed.dataUrl;
		}
	}

	if (!dataUrl) {
		return undefined;
	}

	return { dataUrl, cellIndex: cell.index };
}

// Copy output image to clipboard (menu-driven, e.g. right-click on specific image)
class CopyOutputImageAction extends NotebookAction2 {
	constructor() {
		super({
			id: PositronNotebookActionId.CopyOutputImage,
			title: localize2('positronNotebook.cell.copyOutputImage', "Copy Image"),
			icon: ThemeIcon.fromId('copy'),
			grabFocusOnRun: false,
			menu: [
				{
					id: MenuId.PositronNotebookCellOutputActionBar,
					group: PositronNotebookCellOutputActionGroup.Copy,
					order: 1,
					when: ContextKeyExpr.and(
						// Show the static "Copy Image" action only when there is exactly one
						// image output. For multiple images, users can right-click individual
						// images to copy them.
						ContextKeyExpr.equals(CellContextKeys.imageOutputCount.key, 1),
						CellContextKeys.outputIsCollapsed.toNegated()
					)
				},
				{
					id: MenuId.PositronNotebookCellOutputActionContext,
					group: PositronNotebookCellOutputActionGroup.Copy,
					order: 1,
					when: ContextKeyExpr.and(
						CellContextKeys.outputImageTargeted,
						CellContextKeys.outputIsCollapsed.toNegated()
					)
				},
			],
		});
	}

	override async runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const target = resolveImageOutputTarget(notebook, args);
		if (!target) {
			return;
		}
		await copyImageToClipboard(
			target.dataUrl,
			accessor.get(IClipboardService),
			accessor.get(ILogService),
			accessor.get(INotificationService),
		);
	}
}
registerAction2(CopyOutputImageAction);

// Save an output image to disk (menu-driven)
class SaveOutputImageAction extends NotebookAction2 {
	constructor() {
		super({
			id: PositronNotebookActionId.SaveOutputImage,
			title: localize2('positronNotebook.cell.saveOutputImage', "Save Image"),
			icon: Codicon.save,
			grabFocusOnRun: false,
			menu: [
				{
					id: MenuId.PositronNotebookCellOutputActionBar,
					group: PositronNotebookCellOutputActionGroup.Copy,
					order: 3,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals(CellContextKeys.imageOutputCount.key, 1),
						CellContextKeys.outputIsCollapsed.toNegated()
					)
				},
				{
					id: MenuId.PositronNotebookCellOutputActionContext,
					group: PositronNotebookCellOutputActionGroup.Copy,
					order: 3,
					when: ContextKeyExpr.and(
						CellContextKeys.outputImageTargeted,
						CellContextKeys.outputIsCollapsed.toNegated()
					)
				},
			],
		});
	}

	override async runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const target = resolveImageOutputTarget(notebook, args);
		if (!target) {
			return;
		}
		await saveImageFromDataUrl(
			{ dataUrl: target.dataUrl, notebookUri: notebook.uri, cellIndex: target.cellIndex },
			accessor.get(IFileDialogService),
			accessor.get(IFileService),
			accessor.get(ILogService),
			accessor.get(INotificationService),
		);
	}
}
registerAction2(SaveOutputImageAction);

// Open an output image in a new editor tab (menu-driven)
class OpenOutputImageInNewTabAction extends NotebookAction2 {
	constructor() {
		super({
			id: PositronNotebookActionId.OpenOutputImageInNewTab,
			title: localize2('positronNotebook.cell.openOutputImageInNewTab', "Open Image in New Tab"),
			icon: Codicon.linkExternal,
			grabFocusOnRun: false,
			menu: [
				{
					id: MenuId.PositronNotebookCellOutputActionBar,
					group: PositronNotebookCellOutputActionGroup.Copy,
					order: 4,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals(CellContextKeys.imageOutputCount.key, 1),
						CellContextKeys.outputIsCollapsed.toNegated()
					)
				},
				{
					id: MenuId.PositronNotebookCellOutputActionContext,
					group: PositronNotebookCellOutputActionGroup.Copy,
					order: 4,
					when: ContextKeyExpr.and(
						CellContextKeys.outputImageTargeted,
						CellContextKeys.outputIsCollapsed.toNegated()
					)
				},
			],
		});
	}

	override async runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const target = resolveImageOutputTarget(notebook, args);
		if (!target) {
			return;
		}
		await openImageInEditorFromDataUrl(
			{ dataUrl: target.dataUrl, notebookUri: notebook.uri, cellIndex: target.cellIndex },
			accessor.get(IFileService),
			accessor.get(IEditorService),
		);
	}
}
registerAction2(OpenOutputImageInNewTabAction);
