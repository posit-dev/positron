/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PositronObjectExplorerEditor } from './positronObjectExplorerEditor.js';
import { POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR, POSITRON_OBJECT_EXPLORER_IS_FILE_BACKED, POSITRON_OBJECT_EXPLORER_IS_FOCUSED, POSITRON_OBJECT_EXPLORER_SELECTED_KIND } from './positronObjectExplorerContextKeys.js';
import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';
import { extname } from '../../../../base/common/resources.js';
import { EditorResourceAccessor } from '../../../common/editor.js';
import { ActiveEditorContext, ResourceContextKey } from '../../../common/contextkeys.js';
import { ExplorerFolderContext, TEXT_FILE_EDITOR_ID } from '../../files/common/files.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IPositronDataImporterRegistry } from '../../../services/positronDataExplorer/common/positronDataImporterRegistry.js';
import { IPositronObjectExplorerService } from '../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerService.js';
import { ObjectNodeKind } from '../../../services/positronObjectExplorer/common/objectExplorerBackend.js';
import { ObjectExplorerTreeInstance } from '../../../browser/positronObjectExplorer/classes/objectExplorerTreeInstance.js';
import { showImportDataDialogForFile } from '../../positronDataExplorerEditor/browser/positronDataExplorerImportData.js';

/**
 * Object explorer command IDs.
 */
export const enum PositronObjectExplorerCommandId {
	Refresh = 'workbench.action.positronObjectExplorer.refresh',
	CopyValue = 'workbench.action.positronObjectExplorer.copyValue',
	CopyAccessor = 'workbench.action.positronObjectExplorer.copyAccessor',
	SendAccessorToConsole = 'workbench.action.positronObjectExplorer.sendAccessorToConsole',
	OpenTextInEditor = 'workbench.action.positronObjectExplorer.openTextInEditor',
	OpenInDataExplorer = 'workbench.action.positronObjectExplorer.openInDataExplorer',
	ShowContextMenu = 'workbench.action.positronObjectExplorer.showContextMenu',
	FocusSearch = 'workbench.action.positronObjectExplorer.focusSearch',
	ImportData = 'workbench.action.positronObjectExplorer.importData',
	OpenJsonFile = 'workbench.action.positronObjectExplorer.openJsonFile',
	ImportDataFromJsonFile = 'workbench.action.positronObjectExplorer.importDataFromJsonFile',
}

const category = localize2('positronObjectExplorerCategory', "Object Explorer");

/**
 * True when an object explorer is the active editor and has focus.
 */
const OBJECT_EXPLORER_FOCUSED = ContextKeyExpr.and(
	POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR,
	POSITRON_OBJECT_EXPLORER_IS_FOCUSED.isEqualTo(true)
);

/**
 * True when an object explorer is the active editor and a node is selected.
 */
const OBJECT_EXPLORER_HAS_SELECTION = ContextKeyExpr.and(
	POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR,
	POSITRON_OBJECT_EXPLORER_SELECTED_KIND.notEqualsTo('')
);

/**
 * True when an object explorer is the active editor and the selected node is of a kind.
 */
function objectExplorerSelectionIs(kind: ObjectNodeKind) {
	return ContextKeyExpr.and(
		POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR,
		POSITRON_OBJECT_EXPLORER_SELECTED_KIND.isEqualTo(kind)
	);
}

/**
 * True when the active editor is the text editor for a JSON file.
 */
const JSON_TEXT_EDITOR_IS_ACTIVE = ContextKeyExpr.and(
	ContextKeyExpr.regex(ResourceContextKey.Extension.key, /\.json$/i),
	ActiveEditorContext.isEqualTo(TEXT_FILE_EDITOR_ID)
);

/**
 * True when a file a runtime session could open is selected, rather than a virtual one.
 */
const SESSION_VISIBLE_FILE = ContextKeyExpr.or(
	ResourceContextKey.Scheme.isEqualTo(Schemas.file),
	ResourceContextKey.Scheme.isEqualTo(Schemas.vscodeRemote)
);

/**
 * Gets the active object explorer editor, if there is one.
 */
function activeObjectExplorerEditor(accessor: ServicesAccessor): PositronObjectExplorerEditor | undefined {
	const editorPane = accessor.get(IEditorService).activeEditorPane;
	return editorPane instanceof PositronObjectExplorerEditor ? editorPane : undefined;
}

/**
 * Gets the tree shown by the active object explorer editor, if there is one.
 */
function activeObjectExplorerTree(accessor: ServicesAccessor): ObjectExplorerTreeInstance | undefined {
	return activeObjectExplorerEditor(accessor)?.instance?.activeTreeInstance;
}

class RefreshAction extends Action2 {
	constructor() {
		super({
			id: PositronObjectExplorerCommandId.Refresh,
			title: localize2('positron.objectExplorer.refresh', "Refresh"),
			category,
			f1: true,
			icon: Codicon.refresh,
			precondition: POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			menu: [
				{
					id: MenuId.EditorActionsLeft,
					group: '0_refresh',
					when: POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR,
					order: 1
				},
				{
					id: MenuId.EditorTitle,
					group: 'navigation',
					when: POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await activeObjectExplorerEditor(accessor)?.instance?.refresh();
	}
}

class CopyValueAction extends Action2 {
	constructor() {
		super({
			id: PositronObjectExplorerCommandId.CopyValue,
			title: localize2('positron.objectExplorer.copyValueAction', "Copy Value"),
			category,
			f1: true,
			icon: Codicon.copy,
			precondition: OBJECT_EXPLORER_HAS_SELECTION,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyC,
				when: OBJECT_EXPLORER_FOCUSED
			},
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: '1_selection',
				when: POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR,
				order: 1
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await activeObjectExplorerEditor(accessor)?.instance?.copyValueAtCursor();
	}
}

class CopyAccessorAction extends Action2 {
	constructor() {
		super({
			id: PositronObjectExplorerCommandId.CopyAccessor,
			title: localize2('positron.objectExplorer.copyAccessorAction', "Copy Accessor"),
			category,
			f1: true,
			precondition: OBJECT_EXPLORER_FOCUSED,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
				when: OBJECT_EXPLORER_FOCUSED
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await activeObjectExplorerEditor(accessor)?.instance?.copyAccessorAtCursor();
	}
}

class SendAccessorToConsoleAction extends Action2 {
	constructor() {
		super({
			id: PositronObjectExplorerCommandId.SendAccessorToConsole,
			title: localize2('positron.objectExplorer.sendAccessorToConsoleAction', "Send Accessor to Console"),
			category,
			f1: true,
			icon: Codicon.insert,
			precondition: ContextKeyExpr.and(OBJECT_EXPLORER_HAS_SELECTION, POSITRON_OBJECT_EXPLORER_IS_FILE_BACKED.negate()),
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: '1_selection',
				when: ContextKeyExpr.and(POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR, POSITRON_OBJECT_EXPLORER_IS_FILE_BACKED.negate()),
				order: 2
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const tree = activeObjectExplorerTree(accessor);
		tree?.sendAccessorToConsole(tree.cursorRowIndex);
	}
}

class OpenTextInEditorAction extends Action2 {
	constructor() {
		const when = objectExplorerSelectionIs(ObjectNodeKind.String);
		super({
			id: PositronObjectExplorerCommandId.OpenTextInEditor,
			title: localize2('positron.objectExplorer.openTextInEditorAction', "Open in Editor"),
			category,
			f1: true,
			icon: Codicon.fileText,
			precondition: when,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: '1_selection',
				when,
				order: 3
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const tree = activeObjectExplorerTree(accessor);
		await tree?.openValue(tree.cursorRowIndex);
	}
}

class OpenInDataExplorerAction extends Action2 {
	constructor() {
		const when = objectExplorerSelectionIs(ObjectNodeKind.Table);
		super({
			id: PositronObjectExplorerCommandId.OpenInDataExplorer,
			title: localize2('positron.objectExplorer.openInDataExplorerAction', "Open in Data Explorer"),
			category,
			f1: true,
			icon: Codicon.table,
			precondition: when,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: '1_selection',
				when,
				order: 4
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const tree = activeObjectExplorerTree(accessor);
		await tree?.viewTable(tree.cursorRowIndex);
	}
}

class ShowContextMenuAction extends Action2 {
	constructor() {
		super({
			id: PositronObjectExplorerCommandId.ShowContextMenu,
			title: localize2('positron.objectExplorer.showContextMenu', "Show Context Menu"),
			category,
			f1: true,
			precondition: OBJECT_EXPLORER_FOCUSED,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.F10,
				secondary: [KeyCode.ContextMenu],
				when: OBJECT_EXPLORER_FOCUSED
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await activeObjectExplorerEditor(accessor)?.showContextMenuAtCursor();
	}
}

class FocusSearchAction extends Action2 {
	constructor() {
		super({
			id: PositronObjectExplorerCommandId.FocusSearch,
			title: localize2('positron.objectExplorer.focusSearch', "Find"),
			category,
			f1: true,
			precondition: POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyF,
				when: POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		activeObjectExplorerEditor(accessor)?.instance?.focusSearch();
	}
}

class ImportDataAction extends Action2 {
	constructor() {
		const when = ContextKeyExpr.and(POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR, POSITRON_OBJECT_EXPLORER_IS_FILE_BACKED.isEqualTo(true));
		super({
			id: PositronObjectExplorerCommandId.ImportData,
			title: localize2('positron.objectExplorer.importData', "Import Data"),
			category,
			f1: true,
			precondition: when,
			icon: Codicon.positronImportData,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true
			},
			menu: [
				{
					id: MenuId.EditorActionsLeft,
					group: '2_import',
					when,
					order: 1
				},
				{
					id: MenuId.EditorTitle,
					group: 'navigation',
					when
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const services = importDataServices(accessor);
		const fileUri = activeObjectExplorerEditor(accessor)?.instance?.fileUri;
		if (fileUri) {
			await showImportDataDialogForFile(services, fileUri, {}, undefined);
		}
	}
}

class OpenJsonFileAction extends Action2 {
	constructor() {
		super({
			id: PositronObjectExplorerCommandId.OpenJsonFile,
			title: localize2('positron.objectExplorer.openJsonFile', "Open in Object Explorer"),
			category,
			// No precondition, so agents can open a file by path whatever editor is active.
			icon: Codicon.listTree,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true
			},
			metadata: {
				description: localize('positron.objectExplorer.openJsonFile.description', "Open a JSON file in the Object Explorer, which shows its nested structure as a searchable tree."),
				agentCompatible: true,
				readOnly: true,
				args: [{
					name: 'path',
					isOptional: true,
					description: 'Absolute path or file URI of the JSON file to open. Defaults to the file in the active editor.',
					schema: { type: 'string' }
				}]
			},
			menu: [
				{
					id: MenuId.CommandPalette,
					when: JSON_TEXT_EDITOR_IS_ACTIVE
				},
				{
					id: MenuId.EditorActionsLeft,
					group: '0_json',
					order: 1,
					when: JSON_TEXT_EDITOR_IS_ACTIVE
				},
				{
					id: MenuId.ExplorerContext,
					group: 'navigation',
					order: 31,
					when: ContextKeyExpr.and(
						ExplorerFolderContext.toNegated(),
						ContextKeyExpr.regex(ResourceContextKey.Extension.key, /\.json$/i)
					)
				}
			]
		});
	}

	/**
	 * Runs the action.
	 * @param resource The file, as a URI (from the Explorer context menu) or a path or URI string
	 * (from an agent); otherwise the file in the active editor.
	 */
	async run(accessor: ServicesAccessor, resource?: unknown): Promise<void> {
		const objectExplorerService = accessor.get(IPositronObjectExplorerService);
		const pathService = accessor.get(IPathService);
		const fileUri = URI.isUri(resource) ? resource
			: typeof resource === 'string' ? await toFileUri(pathService, resource)
				: activeJsonFile(accessor);
		if (!fileUri) {
			throw new Error('No path was given and the active editor is not a JSON file.');
		}
		await objectExplorerService.openWithJsonFile(fileUri);
	}
}

class ImportDataFromJsonFileAction extends Action2 {
	constructor() {
		const when = ContextKeyExpr.and(JSON_TEXT_EDITOR_IS_ACTIVE, SESSION_VISIBLE_FILE);
		super({
			id: PositronObjectExplorerCommandId.ImportDataFromJsonFile,
			title: localize2('positron.objectExplorer.importDataFromJsonFile', "Import Data"),
			category,
			// The palette offers the global Import Data command for any file already.
			f1: false,
			precondition: when,
			icon: Codicon.positronImportData,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true
			},
			menu: [
				{
					id: MenuId.EditorActionsLeft,
					group: '0_json',
					order: 2,
					when
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const services = importDataServices(accessor);
		const fileUri = activeFile(accessor);
		if (fileUri) {
			await showImportDataDialogForFile(services, fileUri, {}, undefined);
		}
	}
}

/**
 * Gets the file shown by the active editor, if any.
 */
function activeFile(accessor: ServicesAccessor): URI | undefined {
	return EditorResourceAccessor.getOriginalUri(accessor.get(IEditorService).activeEditor);
}

/**
 * Gets the file shown by the active editor, if it is a JSON file.
 */
function activeJsonFile(accessor: ServicesAccessor): URI | undefined {
	const uri = activeFile(accessor);
	return uri && extname(uri).toLowerCase() === '.json' ? uri : undefined;
}

/**
 * Converts a path or URI string to a URI. Paths and file URIs resolve against the window's file
 * system, which is remote in a remote window.
 */
async function toFileUri(pathService: IPathService, value: string): Promise<URI> {
	const uri = /^[a-z][a-z0-9+.-]+:/i.test(value) ? URI.parse(value) : undefined;
	return uri && uri.scheme !== Schemas.file ? uri : pathService.fileURI(uri ? uri.path : value);
}

/**
 * Collects the services the Import Data dialog needs. An accessor is only valid synchronously, so
 * this must be called before the first await.
 */
function importDataServices(accessor: ServicesAccessor) {
	return {
		environmentService: accessor.get(IWorkbenchEnvironmentService),
		importerRegistry: accessor.get(IPositronDataImporterRegistry),
		runtimeSessionService: accessor.get(IRuntimeSessionService),
	};
}

/**
 * Registers the object explorer actions.
 */
export function registerPositronObjectExplorerActions(): void {
	registerAction2(RefreshAction);
	registerAction2(CopyValueAction);
	registerAction2(CopyAccessorAction);
	registerAction2(SendAccessorToConsoleAction);
	registerAction2(OpenTextInEditorAction);
	registerAction2(OpenInDataExplorerAction);
	registerAction2(ShowContextMenuAction);
	registerAction2(FocusSearchAction);
	registerAction2(ImportDataAction);
	registerAction2(OpenJsonFileAction);
	registerAction2(ImportDataFromJsonFileAction);
}
