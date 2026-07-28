/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { DEFAULT_EDITOR_ASSOCIATION, EditorResourceAccessor, IEditorPane } from '../../../common/editor.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IsDevelopmentContext, IsWebContext } from '../../../../platform/contextkey/common/contextkeys.js';
import { RemoteNameContext } from '../../../common/contextkeys.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { viewVariableItem } from '../../../services/positronDataExplorer/browser/positronDataExplorerViewVariableItem.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { POSITRON_RUNTIME_LANGUAGE_IDS } from '../../languageRuntime/browser/languageRuntimeContextKeys.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IDataFrameResolutionServices, resolveDataFrameAtPosition } from './positronDataExplorerResolveDataFrame.js';
import { IPositronDataExplorerEditor } from './positronDataExplorerEditor.js';
import { IPositronDataExplorerService, PositronDataExplorerLayout } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { PositronDataExplorerEditorInput } from './positronDataExplorerEditorInput.js';
import { POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR, POSITRON_DATA_EXPLORER_IS_COLUMN_SORTING, POSITRON_DATA_EXPLORER_IS_CONVERT_TO_CODE_ENABLED, POSITRON_DATA_EXPLORER_CODE_SYNTAXES_AVAILABLE, POSITRON_DATA_EXPLORER_IS_ROW_FILTERING, POSITRON_DATA_EXPLORER_IS_PLAINTEXT, POSITRON_DATA_EXPLORER_IS_XLSX, POSITRON_DATA_EXPLORER_LAYOUT, POSITRON_DATA_EXPLORER_IS_FOCUSED } from './positronDataExplorerContextKeys.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { PositronDataExplorerUri } from '../../../services/positronDataExplorer/common/positronDataExplorerUri.js';
import { EditorOpenSource } from '../../../../platform/editor/common/editor.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { toLocalResource } from '../../../../base/common/resources.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { showConvertToCodeModalDialog } from '../../../browser/positronModalDialogs/convertToCodeModalDialog.js';
import { showFileOptionsModalDialog } from '../../../browser/positronModalDialogs/fileOptionsModalDialog.js';
import { IPositronDataExplorerInstance } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { CodeSyntaxName } from '../../../services/languageRuntime/common/positronDataExplorerComm.js';
import { mainWindow } from '../../../../base/browser/window.js';

/**
 * Positron Data Explorer action category.
 */
const POSITRON_DATA_EXPLORER_ACTION_CATEGORY = localize(
	'positronDataExplorerCategory',
	"Data Explorer"
);

/**
 * The category for the actions below.
 */
const category: ILocalizedString = {
	value: POSITRON_DATA_EXPLORER_ACTION_CATEGORY,
	original: 'Data Explorer'
};

/**
 * Positron data explorer command ID's.
 */
export const enum PositronDataExplorerCommandId {
	CopyAction = 'workbench.action.positronDataExplorer.copy',
	CopyTableDataAction = 'workbench.action.positronDataExplorer.copyTableData',
	CollapseSummaryAction = 'workbench.action.positronDataExplorer.collapseSummary',
	ExpandSummaryAction = 'workbench.action.positronDataExplorer.expandSummary',
	SummaryOnLeftAction = 'workbench.action.positronDataExplorer.summaryOnLeft',
	SummaryOnRightAction = 'workbench.action.positronDataExplorer.summaryOnRight',
	ClearColumnSortingAction = 'workbench.action.positronDataExplorer.clearColumnSorting',
	OpenAsPlaintext = 'workbench.action.positronDataExplorer.openAsPlaintext',
	OpenAsSpreadsheet = 'workbench.action.positronDataExplorer.openAsSpreadsheet',
	ConvertToCodeAction = 'workbench.action.positronDataExplorer.convertToCode',
	ConvertToCodeModalAction = 'workbench.action.positronDataExplorer.convertToCodeModal',
	FileOptionsAction = 'workbench.action.positronDataExplorer.fileOptions',
	ShowColumnContextMenuAction = 'workbench.action.positronDataExplorer.showColumnContextMenu',
	ShowRowContextMenuAction = 'workbench.action.positronDataExplorer.showRowContextMenu',
	ShowCellContextMenuAction = 'workbench.action.positronDataExplorer.showCellContextMenu',
	ViewDataFrameAtCursorAction = 'workbench.action.positronDataExplorer.viewDataFrameAtCursor',
	ViewDataFrameByVariableAction = 'workbench.action.positronDataExplorer.viewDataFrameByVariable',
}

/**
 * Gets the IPositronDataExplorerEditor for the specified editor pane.
 * @param editorPane The editor pane.
 * @returns The IPositronDataExplorerEditor for the editor pane, or undefined, if the editor pane
 * is not a Positron data explorer editor.
 */
export const getPositronDataExplorerEditorFromEditorPane = (
	editorPane?: IEditorPane
): IPositronDataExplorerEditor | undefined => {
	// If the editor pane is a Positron data explorer editor, return the editor.
	if (editorPane && editorPane.getId() === PositronDataExplorerEditorInput.EditorID) {
		return editorPane.getControl() as unknown as IPositronDataExplorerEditor | undefined;
	}

	// The editor pane is not a Positron data explorer editor.
	return undefined;
};

const getPositronDataExplorerInstance = async (
	accessor: ServicesAccessor
): Promise<IPositronDataExplorerInstance | undefined> => {
	// Access the services we need.
	const editorService = accessor.get(IEditorService);
	const positronDataExplorerService = accessor.get(IPositronDataExplorerService);
	const notificationService = accessor.get(INotificationService);

	/**
	 * Notifies the user that no data explorer instance was found.
	 */
	const notifyUserThatDataExplorerNotFound = () => {
		// Notify the user.
		notificationService.notify({
			severity: Severity.Error,
			message: localize(
				'positron.dataExplorer.noActiveDataExplorer',
				"No Positron Data Explorer found."
			),
			sticky: false
		});
	};
	// Get the Positron data explorer editor.
	const positronDataExplorerEditor = getPositronDataExplorerEditorFromEditorPane(
		editorService.activeEditorPane
	);

	// Make sure that the Positron data explorer editor was returned.
	if (!positronDataExplorerEditor) {
		notifyUserThatDataExplorerNotFound();
		return;
	}

	// Get the identifier.
	const identifier = positronDataExplorerEditor.identifier;

	// Make sure the identifier was returned.
	if (!identifier) {
		notifyUserThatDataExplorerNotFound();
		return;
	}
	const positronDataExplorerInstance = positronDataExplorerService.getInstance(identifier);

	if (!positronDataExplorerInstance) {
		notifyUserThatDataExplorerNotFound();
		return;
	}

	// Get the Positron data explorer instance.
	return positronDataExplorerInstance;
};

/**
 * PositronDataExplorerCopyAction action.
 */
class PositronDataExplorerCopyAction extends Action2 {
	constructor() {
		super({
			id: PositronDataExplorerCommandId.CopyAction,
			title: {
				value: localize('positronDataExplorer.copy', 'Copy'),
				original: 'Copy'
			},
			category,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyC,
			},
			f1: true,
			precondition: ContextKeyExpr.and(
				POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
				POSITRON_DATA_EXPLORER_IS_FOCUSED
			)
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const positronDataExplorerService = accessor.get(IPositronDataExplorerService);

		// Get the Positron data explorer editor.
		const positronDataExplorerEditor = getPositronDataExplorerEditorFromEditorPane(
			editorService.activeEditorPane
		);

		/**
		 * Notifies the user that copy operation failed.
		 */
		const notifyUserThatCopyFailed = () => {
			// Notify the user.
			notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'positron.dataExplorer.copy.noActiveEditor',
					"Cannot copy. A Positron Data Explorer is not active."
				),
				sticky: false
			});
		};

		// Make sure that the Positron data explorer editor was returned.
		if (!positronDataExplorerEditor) {
			notifyUserThatCopyFailed();
			return;
		}

		// Get the identifier.
		const identifier = positronDataExplorerEditor.identifier;

		// Make sure the identifier was returned.
		if (!identifier) {
			notifyUserThatCopyFailed();
			return;
		}

		// Get the Positron data explorer instance.
		const positronDataExplorerInstance = positronDataExplorerService.getInstance(
			identifier
		);

		// Make sure the Positron data explorer instance was returned.
		if (!positronDataExplorerInstance) {
			notifyUserThatCopyFailed();
			return;
		}

		// Copy the selection or cursor cell to the clipboard.
		await positronDataExplorerInstance.copyToClipboard();
	}
}

/**
 * PositronDataExplorerCopyTableDataAction action.
 */
class PositronDataExplorerCopyTableDataAction extends Action2 {
	constructor() {
		super({
			id: PositronDataExplorerCommandId.CopyTableDataAction,
			title: {
				value: localize('positronDataExplorer.copyTableData', 'Copy Table Data'),
				original: 'Copy Table Data'
			},
			category,
			f1: true,
			precondition: ContextKeyExpr.and(
				POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
				POSITRON_DATA_EXPLORER_IS_FOCUSED,
				IsDevelopmentContext
			)
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const positronDataExplorerService = accessor.get(IPositronDataExplorerService);

		// Get the Positron data explorer editor.
		const positronDataExplorerEditor = getPositronDataExplorerEditorFromEditorPane(
			editorService.activeEditorPane
		);

		/**
		 * Notifies the user that copy operation failed.
		 */
		const notifyUserThatCopyFailed = () => {
			// Notify the user.
			notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'positron.dataExplorer.copyTableData.noActiveEditor',
					"Cannot copy table data. A Positron Data Explorer is not active."
				),
				sticky: false
			});
		};

		// Make sure that the Positron data explorer editor was returned.
		if (!positronDataExplorerEditor) {
			notifyUserThatCopyFailed();
			return;
		}

		// Get the identifier.
		const identifier = positronDataExplorerEditor.identifier;

		// Make sure the identifier was returned.
		if (!identifier) {
			notifyUserThatCopyFailed();
			return;
		}

		// Get the Positron data explorer instance.
		const positronDataExplorerInstance = positronDataExplorerService.getInstance(
			identifier
		);

		// Make sure the Positron data explorer instance was returned.
		if (!positronDataExplorerInstance) {
			notifyUserThatCopyFailed();
			return;
		}

		// Copy the table data to the clipboard.
		await positronDataExplorerInstance.copyTableDataToClipboard();
	}
}

/**
 * PositronDataExplorerCollapseSummaryAction action.
 */
class PositronDataExplorerCollapseSummaryAction extends Action2 {
	constructor() {
		super({
			id: PositronDataExplorerCommandId.CollapseSummaryAction,
			title: {
				value: localize('positronDataExplorer.collapseSummary', 'Collapse Summary'),
				original: 'Collapse Summary'
			},
			category,
			f1: true,
			precondition: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
			metadata: {
				description: localize('positron.dataExplorer.collapseSummary.description', "Collapse the column summary panel in the active Data Explorer."),
				agentCompatible: true,
			},
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const positronDataExplorerService = accessor.get(IPositronDataExplorerService);

		// Get the Positron data explorer editor.
		const positronDataExplorerEditor = getPositronDataExplorerEditorFromEditorPane(
			editorService.activeEditorPane
		);

		/**
		 * Notifies the user that collapse summary failed.
		 */
		const notifyUserThatCollapseSummaryFailed = () => {
			// Notify the user.
			notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'positron.dataExplorer.collapseSummary.noActiveEditor',
					"Cannot Collapse Summary. A Positron Data Explorer is not active."
				),
				sticky: false
			});
		};

		// Make sure that the Positron data explorer editor was returned.
		if (!positronDataExplorerEditor) {
			notifyUserThatCollapseSummaryFailed();
			return;
		}

		// Get the identifier.
		const identifier = positronDataExplorerEditor.identifier;

		// Make sure the identifier was returned.
		if (!identifier) {
			notifyUserThatCollapseSummaryFailed();
			return;
		}

		// Get the Positron data explorer instance.
		const positronDataExplorerInstance = positronDataExplorerService.getInstance(
			identifier
		);

		// Make sure the Positron data explorer instance was returned.
		if (!positronDataExplorerInstance) {
			notifyUserThatCollapseSummaryFailed();
			return;
		}

		// Collapse the summary.
		positronDataExplorerInstance.collapseSummary();
	}
}

/**
 * PositronDataExplorerExpandSummaryAction action.
 */
class PositronDataExplorerExpandSummaryAction extends Action2 {
	constructor() {
		super({
			id: PositronDataExplorerCommandId.ExpandSummaryAction,
			title: {
				value: localize('positronDataExplorer.expandSummary', 'Expand Summary'),
				original: 'Expand Summary'
			},
			category,
			f1: true,
			precondition: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
			metadata: {
				description: localize('positron.dataExplorer.expandSummary.description', "Expand the column summary panel in the active Data Explorer."),
				agentCompatible: true,
			},
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const positronDataExplorerService = accessor.get(IPositronDataExplorerService);

		// Get the Positron data explorer editor.
		const positronDataExplorerEditor = getPositronDataExplorerEditorFromEditorPane(
			editorService.activeEditorPane
		);

		/**
		 * Notifies the user that expand summary failed.
		 */
		const notifyUserThatExpandSummaryFailed = () => {
			// Notify the user.
			notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'positron.dataExplorer.expandSummary.noActiveEditor',
					"Cannot Expand Summary. A Positron Data Explorer is not active."
				),
				sticky: false
			});
		};

		// Make sure that the Positron data explorer editor was returned.
		if (!positronDataExplorerEditor) {
			notifyUserThatExpandSummaryFailed();
			return;
		}

		// Get the identifier.
		const identifier = positronDataExplorerEditor.identifier;

		// Make sure the identifier was returned.
		if (!identifier) {
			notifyUserThatExpandSummaryFailed();
			return;
		}

		// Get the Positron data explorer instance.
		const positronDataExplorerInstance = positronDataExplorerService.getInstance(
			identifier
		);

		// Make sure the Positron data explorer instance was returned.
		if (!positronDataExplorerInstance) {
			notifyUserThatExpandSummaryFailed();
			return;
		}

		// Expand the summary.
		positronDataExplorerInstance.expandSummary();
	}
}

/**
 * PositronDataExplorerSummaryOnLeftAction action.
 */
class PositronDataExplorerSummaryOnLeftAction extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronDataExplorerCommandId.SummaryOnLeftAction,
			title: {
				value: localize('positronDataExplorer.summaryOnLeft', 'Summary on Left'),
				original: 'Summary on Left'
			},
			category,
			f1: true,
			precondition: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
			icon: Codicon.positronDataExplorerSummaryOnLeft,
			toggled: ContextKeyExpr.and(
				POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
				POSITRON_DATA_EXPLORER_LAYOUT.isEqualTo(
					PositronDataExplorerLayout.SummaryOnLeft
				)
			),
			menu: [
				{
					id: MenuId.EditorTitle,
					when: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
					group: '1_data_explorer',
					order: 1
				},
			]
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const positronDataExplorerService = accessor.get(IPositronDataExplorerService);

		// Get the Positron data explorer editor.
		const positronDataExplorerEditor = getPositronDataExplorerEditorFromEditorPane(
			editorService.activeEditorPane
		);

		/**
		 * Notifies the user that layout failed.
		 */
		const notifyUserThatLayoutFailed = () => {
			// Notify the user.
			notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'positron.dataExplorer.changeLayout.noActiveEditor',
					"Cannot Change Layout. A Positron Data Explorer is not active."
				),
				sticky: false
			});
		};

		// Make sure that the Positron data explorer editor was returned.
		if (!positronDataExplorerEditor) {
			notifyUserThatLayoutFailed();
			return;
		}

		// Get the identifier.
		const identifier = positronDataExplorerEditor.identifier;

		// Make sure the identifier was returned.
		if (!identifier) {
			notifyUserThatLayoutFailed();
			return;
		}

		// Get the Positron data explorer instance.
		const positronDataExplorerInstance = positronDataExplorerService.getInstance(
			identifier
		);

		// Make sure the Positron data explorer instance was returned.
		if (!positronDataExplorerInstance) {
			notifyUserThatLayoutFailed();
			return;
		}

		// Change layout.
		positronDataExplorerInstance.layout = PositronDataExplorerLayout.SummaryOnLeft;
	}
}

/**
 * PositronDataExplorerSummaryOnRightAction action.
 */
class PositronDataExplorerSummaryOnRightAction extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronDataExplorerCommandId.SummaryOnRightAction,
			title: {
				value: localize('positronDataExplorer.summaryOnRight', 'Summary on Right'),
				original: 'Summary on Right'
			},
			category,
			f1: true,
			precondition: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
			icon: Codicon.positronDataExplorerSummaryOnRight,
			toggled: ContextKeyExpr.and(
				POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
				POSITRON_DATA_EXPLORER_LAYOUT.isEqualTo(
					PositronDataExplorerLayout.SummaryOnRight
				)
			),
			menu: [
				{
					id: MenuId.EditorTitle,
					when: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
					group: '1_data_explorer',
					order: 2
				},
			]
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const positronDataExplorerService = accessor.get(IPositronDataExplorerService);

		// Get the Positron data explorer editor.
		const positronDataExplorerEditor = getPositronDataExplorerEditorFromEditorPane(
			editorService.activeEditorPane
		);

		/**
		 * Notifies the user that layout failed.
		 */
		const notifyUserThatLayoutFailed = () => {
			// Notify the user.
			notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'positron.dataExplorer.changeLayout.noActiveEditor',
					"Cannot Change Layout. A Positron Data Explorer is not active."
				),
				sticky: false
			});
		};

		// Make sure that the Positron data explorer editor was returned.
		if (!positronDataExplorerEditor) {
			notifyUserThatLayoutFailed();
			return;
		}

		// Get the identifier.
		const identifier = positronDataExplorerEditor.identifier;

		// Make sure the identifier was returned.
		if (!identifier) {
			notifyUserThatLayoutFailed();
			return;
		}

		// Get the Positron data explorer instance.
		const positronDataExplorerInstance = positronDataExplorerService.getInstance(
			identifier
		);

		// Make sure the Positron data explorer instance was returned.
		if (!positronDataExplorerInstance) {
			notifyUserThatLayoutFailed();
			return;
		}

		// Change layout.
		positronDataExplorerInstance.layout = PositronDataExplorerLayout.SummaryOnRight;
	}
}

/**
 * PositronDataExplorerClearColumnSortingAction action.
 */
class PositronDataExplorerClearColumnSortingAction extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronDataExplorerCommandId.ClearColumnSortingAction,
			title: {
				value: localize('positronDataExplorer.clearColumnSorting', 'Clear Column Sorting'),
				original: 'Clear Column Sorting'
			},
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true,
			},
			category,
			f1: true,
			precondition: ContextKeyExpr.and(
				POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
				POSITRON_DATA_EXPLORER_IS_COLUMN_SORTING
			),
			icon: Codicon.positronClearSorting,
			menu: [
				{
					id: MenuId.EditorActionsLeft,
					when: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
				},
				{
					id: MenuId.EditorTitle,
					group: 'navigation',
					when: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
				}
			]
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const positronDataExplorerService = accessor.get(IPositronDataExplorerService);

		// Get the Positron data explorer editor.
		const positronDataExplorerEditor = getPositronDataExplorerEditorFromEditorPane(
			editorService.activeEditorPane
		);

		/**
		 * Notifies the user that clear sorting failed.
		 */
		const notifyUserThatClearSortingFailed = () => {
			// Notify the user.
			notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'positron.dataExplorer.clearSorting.noActiveEditor',
					"Cannot Clear Sorting. A Positron Data Explorer is not active."
				),
				sticky: false
			});
		};

		// Make sure that the Positron data explorer editor was returned.
		if (!positronDataExplorerEditor) {
			notifyUserThatClearSortingFailed();
			return;
		}

		// Get the identifier.
		const identifier = positronDataExplorerEditor.identifier;

		// Make sure the identifier was returned.
		if (!identifier) {
			notifyUserThatClearSortingFailed();
			return;
		}

		// Get the Positron data explorer instance.
		const positronDataExplorerInstance = positronDataExplorerService.getInstance(
			identifier
		);

		// Make sure the Positron data explorer instance was returned.
		if (!positronDataExplorerInstance) {
			notifyUserThatClearSortingFailed();
			return;
		}

		// Clear column sorting.
		await positronDataExplorerInstance.clearColumnSorting();
	}
}

/**
 * PositronDataExplorerConvertToCodeAction action.
 */
class PositronDataExplorerConvertToCodeAction extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronDataExplorerCommandId.ConvertToCodeAction,
			title: {
				value: localize('positronDataExplorer.convertToCode', 'Convert to Code'),
				original: 'Convert to Code'
			},
			category,
			precondition: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor, desiredSyntax: CodeSyntaxName): Promise<string | undefined> {
		const positronDataExplorerInstance = await getPositronDataExplorerInstance(accessor);
		if (!positronDataExplorerInstance) {
			return undefined;
		}
		const code = await positronDataExplorerInstance.convertToCode(desiredSyntax);

		// Export filters as code.
		return code;
	}
}


/**
 * The PositronDataExplorerConvertToCodeModalAction.
 */
class PositronDataExplorerConvertToCodeModalAction extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronDataExplorerCommandId.ConvertToCodeModalAction,
			title: {
				value: localize('positronDataExplorer.convertToCodeModal', 'Convert to Code'),
				original: 'Convert to Code'
			},
			category,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true,
			},
			f1: true,
			precondition: ContextKeyExpr.and(
				POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
				POSITRON_DATA_EXPLORER_CODE_SYNTAXES_AVAILABLE,
				ContextKeyExpr.or(
					POSITRON_DATA_EXPLORER_IS_COLUMN_SORTING,
					POSITRON_DATA_EXPLORER_IS_ROW_FILTERING)
			),
			keybinding: {
				when: ContextKeyExpr.and(
					POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
					POSITRON_DATA_EXPLORER_CODE_SYNTAXES_AVAILABLE,
					ContextKeyExpr.or(
						POSITRON_DATA_EXPLORER_IS_COLUMN_SORTING,
						POSITRON_DATA_EXPLORER_IS_ROW_FILTERING)
				),
				weight: KeybindingWeight.WorkbenchContrib + 1,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyC),
			},
			icon: Codicon.code,
			menu: [
				{
					id: MenuId.EditorActionsLeft,
					when: ContextKeyExpr.and(
						POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
						POSITRON_DATA_EXPLORER_IS_CONVERT_TO_CODE_ENABLED
					),
				},
				{
					id: MenuId.EditorTitle,
					group: 'navigation',
					when: ContextKeyExpr.and(
						POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
						POSITRON_DATA_EXPLORER_IS_CONVERT_TO_CODE_ENABLED
					),
				}
			]
		});
	}

	/**
	 * Runs action.
	 * @param accessor The services accessor.
	 */
	override async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const positronDataExplorerInstance = await getPositronDataExplorerInstance(accessor);

		if (!positronDataExplorerInstance) {
			return undefined;
		}

		await showConvertToCodeModalDialog(
			positronDataExplorerInstance,
		);
	}
}

/**
 * PositronDataExplorerOpenAsPlaintextAction action.
 */
class PositronDataExplorerOpenAsPlaintextAction extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		// This action applies to delimited text files (CSV/TSV) but not Excel
		// workbooks, which are opened with the OS-native application instead via
		// PositronDataExplorerOpenAsSpreadsheetAction.
		const when = ContextKeyExpr.and(
			POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
			POSITRON_DATA_EXPLORER_IS_PLAINTEXT,
			POSITRON_DATA_EXPLORER_IS_XLSX.toNegated()
		);
		super({
			id: PositronDataExplorerCommandId.OpenAsPlaintext,
			title: {
				value: localize('positronDataExplorer.openAsPlaintext', 'Open as Plain Text File'),
				original: 'Open as Plain Text File'
			},
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true,
			},
			category,
			f1: true,
			precondition: when,
			icon: Codicon.fileText,
			menu: [
				{
					id: MenuId.EditorActionsLeft,
					when
				},
				{
					id: MenuId.EditorTitle,
					group: 'navigation',
					when
				}
			]
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const pathService = accessor.get(IPathService);
		const environmentService = accessor.get(IWorkbenchEnvironmentService);
		const editorService = accessor.get(IEditorService);

		// Grab Data Explorer URI (scheme = positron-data-explorer)
		const originalURI = EditorResourceAccessor.getOriginalUri(editorService.activeEditor);
		if (!originalURI) {
			return;
		}

		let backingUri = PositronDataExplorerUri.backingUri(originalURI);
		if (!backingUri) {
			return;
		}

		// Convert file URIs to the "local" scheme, i.e. vscode-remote when
		// running as a server.
		if (backingUri.scheme === 'file') {
			backingUri = toLocalResource(
				backingUri,
				environmentService.remoteAuthority,
				pathService.defaultUriScheme
			);
		}

		// Invoke editor for file, using default editor (text) association
		await editorService.openEditor({
			resource: backingUri,
			options: {
				override: DEFAULT_EDITOR_ASSOCIATION.id,
				source: EditorOpenSource.USER
			}
		});
	}
}

/**
 * PositronDataExplorerOpenAsSpreadsheetAction action.
 *
 * Opens an Excel workbook (.xlsx) backing the Data Explorer with the OS-native
 * application (typically Excel). Only available in the local desktop app;
 * opening a file with the OS-native application is not possible in the
 * web/server build, nor when connected to a remote, so the action is hidden in
 * those cases.
 */
class PositronDataExplorerOpenAsSpreadsheetAction extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		const when = ContextKeyExpr.and(
			POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
			POSITRON_DATA_EXPLORER_IS_XLSX,
			IsWebContext.toNegated(),
			RemoteNameContext.isEqualTo('')
		);
		super({
			id: PositronDataExplorerCommandId.OpenAsSpreadsheet,
			title: {
				value: localize('positronDataExplorer.openAsSpreadsheet', 'Open as Spreadsheet'),
				original: 'Open as Spreadsheet'
			},
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true,
			},
			category,
			f1: true,
			precondition: when,
			icon: Codicon.githubProject,
			menu: [
				{
					id: MenuId.EditorActionsLeft,
					when
				},
				{
					id: MenuId.EditorTitle,
					group: 'navigation',
					when
				}
			]
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const editorService = accessor.get(IEditorService);
		const openerService = accessor.get(IOpenerService);

		// Grab Data Explorer URI (scheme = positron-data-explorer)
		const originalURI = EditorResourceAccessor.getOriginalUri(editorService.activeEditor);
		if (!originalURI) {
			return;
		}

		const backingUri = PositronDataExplorerUri.backingUri(originalURI);
		if (!backingUri) {
			return;
		}

		// Open the file with the OS-native application (Excel). On the desktop,
		// the opener service routes external opens through the native host,
		// which opens local files with their default application.
		await openerService.open(backingUri, { openExternal: true });
	}
}

/**
 * PositronDataExplorerFileOptionsAction action.
 * Opens a modal dialog for configuring file import options (e.g., header row setting)
 * when viewing CSV/TSV files in the Data Explorer.
 */
class PositronDataExplorerFileOptionsAction extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronDataExplorerCommandId.FileOptionsAction,
			title: {
				value: localize('positronDataExplorer.fileOptions', 'File Options'),
				original: 'File Options'
			},
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true,
			},
			category,
			f1: true,
			precondition: ContextKeyExpr.and(
				POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
				POSITRON_DATA_EXPLORER_IS_PLAINTEXT
			),
			icon: Codicon.settingsGear,
			menu: [
				{
					id: MenuId.EditorActionsLeft,
					when: ContextKeyExpr.and(
						POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
						POSITRON_DATA_EXPLORER_IS_PLAINTEXT
					),
					order: 0
				},
				{
					id: MenuId.EditorTitle,
					group: 'navigation',
					when: ContextKeyExpr.and(
						POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
						POSITRON_DATA_EXPLORER_IS_PLAINTEXT
					)
				}
			]
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		const positronDataExplorerInstance = await getPositronDataExplorerInstance(accessor);
		if (!positronDataExplorerInstance) {
			return;
		}

		await showFileOptionsModalDialog(positronDataExplorerInstance);
	}
}

/**
 * PositronDataExplorerShowColumnContextMenuAction action.
 */
class PositronDataExplorerShowColumnContextMenuAction extends Action2 {
	constructor() {
		super({
			id: PositronDataExplorerCommandId.ShowColumnContextMenuAction,
			title: {
				value: localize('positronDataExplorer.showColumnContextMenu', 'Show Column Context Menu'),
				original: 'Show Column Context Menu'
			},
			category,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.F10,
			},
			precondition: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		const positronDataExplorerInstance = await getPositronDataExplorerInstance(accessor);
		if (!positronDataExplorerInstance) {
			return;
		}

		// Get the table data grid instance
		const tableDataDataGridInstance = positronDataExplorerInstance.tableDataDataGridInstance;

		// Get the current column the cursor is positioned at
		const cursorColumnIndex = tableDataDataGridInstance.cursorColumnIndex;

		// Find the column header element for the column the cursor is positioned at
		// by querying the DOM
		const columnHeaderElement = mainWindow.document.querySelector(
			`.data-grid-column-header[data-column-index="${cursorColumnIndex}"]`
		) as HTMLElement;

		if (columnHeaderElement) {
			const headerRect = columnHeaderElement.getBoundingClientRect();
			await tableDataDataGridInstance.showColumnContextMenu(
				cursorColumnIndex,
				columnHeaderElement,
				// position the context menu in the center of the cell
				{
					clientX: headerRect.left + headerRect.width / 2,
					clientY: headerRect.top + headerRect.height / 2
				}
			);
		}
	}
}

/**
 * PositronDataExplorerShowRowContextMenuAction action.
 */
class PositronDataExplorerShowRowContextMenuAction extends Action2 {
	constructor() {
		super({
			id: PositronDataExplorerCommandId.ShowRowContextMenuAction,
			title: {
				value: localize('positronDataExplorer.showRowContextMenu', 'Show Row Context Menu'),
				original: 'Show Row Context Menu'
			},
			category,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.F10,
			},
			precondition: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		const positronDataExplorerInstance = await getPositronDataExplorerInstance(accessor);
		if (!positronDataExplorerInstance) {
			return;
		}

		// Get the table data grid instance
		const tableDataDataGridInstance = positronDataExplorerInstance.tableDataDataGridInstance;

		// Get the current row the cursor is positioned at
		const cursorRowIndex = tableDataDataGridInstance.cursorRowIndex;

		// Find the row header element for the row the cursor is positioned at
		// by querying the DOM
		const rowHeaderElement = mainWindow.document.querySelector(
			`.data-grid-row-header[data-row-index="${cursorRowIndex}"]`
		) as HTMLElement;

		if (rowHeaderElement) {
			const headerRect = rowHeaderElement.getBoundingClientRect();
			await tableDataDataGridInstance.showRowContextMenu(
				cursorRowIndex,
				rowHeaderElement,
				// position the context menu in the center of the cell
				{
					clientX: headerRect.left + headerRect.width / 2,
					clientY: headerRect.top + headerRect.height / 2
				}
			);
		}
	}
}

/**
 * PositronDataExplorerShowCellContextMenuAction action.
 */
class PositronDataExplorerShowCellContextMenuAction extends Action2 {
	constructor() {
		super({
			id: PositronDataExplorerCommandId.ShowCellContextMenuAction,
			title: {
				value: localize('positronDataExplorer.showCellContextMenu', 'Show Cell Context Menu'),
				original: 'Show Cell Context Menu'
			},
			category,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.F10,
			},
			precondition: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		const positronDataExplorerInstance = await getPositronDataExplorerInstance(accessor);
		if (!positronDataExplorerInstance) {
			return;
		}

		// Get the table data grid instance
		const tableDataDataGridInstance = positronDataExplorerInstance.tableDataDataGridInstance;

		// Get the location of the cursor
		const cursorColumnIndex = tableDataDataGridInstance.cursorColumnIndex;
		const cursorRowIndex = tableDataDataGridInstance.cursorRowIndex;

		// Find the cell element the cursor is on by querying the DOM
		const cellElement = mainWindow.document.querySelector(
			`#data-grid-row-cell-content-${cursorColumnIndex}-${cursorRowIndex}`
		) as HTMLElement;

		if (cellElement) {
			const cellRect = cellElement.getBoundingClientRect();
			await tableDataDataGridInstance.showCellContextMenu(
				cursorColumnIndex,
				cursorRowIndex,
				cellElement,
				// position the context menu in the center of the cell
				{
					clientX: cellRect.left + cellRect.width / 2,
					clientY: cellRect.top + cellRect.height / 2
				}
			);
		}
	}
}

/**
 * PositronDataExplorerViewDataFrameAtCursorAction opens the Data Explorer
 * for the identifier at the editor cursor, if that identifier names a
 * viewable variable in the console session for the editor's language.
 */
export class PositronDataExplorerViewDataFrameAtCursorAction extends Action2 {
	constructor() {
		super({
			id: PositronDataExplorerCommandId.ViewDataFrameAtCursorAction,
			title: {
				value: localize('positronDataExplorer.viewDataFrameAtCursor', 'View Data Frame at Cursor'),
				original: 'View Data Frame at Cursor'
			},
			category,
			f1: true,
			menu: [
				{
					id: MenuId.EditorContext,
					// Show on editors whose language has a registered Positron
					// runtime. The list is maintained dynamically by
					// PositronRuntimeLanguagesContextKeyContribution so new
					// runtimes are picked up without code changes here.
					//
					// Quarto is added explicitly: a .qmd document's outer
					// language is 'quarto', but the command still works
					// because it resolves the embedded language at the
					// cursor via getLanguageIdAtPosition.
					when: ContextKeyExpr.and(
						EditorContextKeys.editorTextFocus,
						ContextKeyExpr.or(
							ContextKeyExpr.in(
								EditorContextKeys.languageId.key,
								POSITRON_RUNTIME_LANGUAGE_IDS.key,
							),
							ContextKeyExpr.equals(
								EditorContextKeys.languageId.key,
								'quarto',
							),
						),
					),
					group: 'navigation',
					order: 1.5,
				},
			],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const dataExplorerService = accessor.get(IPositronDataExplorerService);
		const notificationService = accessor.get(INotificationService);
		const services: IDataFrameResolutionServices = {
			languageService: accessor.get(ILanguageService),
			runtimeSessionService: accessor.get(IRuntimeSessionService),
			variablesService: accessor.get(IPositronVariablesService),
			viewsService: accessor.get(IViewsService),
		};

		const control = editorService.activeTextEditorControl;
		if (!isCodeEditor(control)) {
			notificationService.info(localize(
				'positron.viewDataFrameAtCursor.noEditor',
				"Place the cursor in the editor on the data frame you'd like to view."
			));
			return;
		}
		const model = control.getModel();
		const position = control.getPosition();
		if (!model || !position) {
			return;
		}

		// Interactive invocation: open the Variables pane if needed and wait for
		// a freshly-created instance to report its variables.
		const resolution = await resolveDataFrameAtPosition(model, position, services, {
			wait: true,
			openVariablesViewIfNeeded: true,
		});

		switch (resolution.kind) {
			case 'no-symbol':
				notificationService.info(localize(
					'positron.viewDataFrameAtCursor.noSymbol',
					"No symbol at cursor."
				));
				return;
			case 'no-session':
				notificationService.info(localize(
					'positron.viewDataFrameAtCursor.noSession',
					"No active {0} session.",
					resolution.languageName,
				));
				return;
			case 'variables-unavailable':
				notificationService.info(localize(
					'positron.viewDataFrameAtCursor.variablesUnavailable',
					"Variables for the active {0} session are not available yet.",
					resolution.languageName,
				));
				return;
			case 'not-found':
				// If we timed out waiting for the first variable update, the
				// symbol might actually be defined but the runtime hasn't
				// reported it yet (e.g. a long-running chunk that assigns the
				// variable and then keeps running). Tell the user that rather
				// than flatly claiming the variable doesn't exist.
				if (resolution.timedOut) {
					notificationService.info(localize(
						'positron.viewDataFrameAtCursor.variablesTimeout',
						"The active {0} session is still loading variables. Try again in a moment.",
						resolution.languageName,
					));
				} else {
					notificationService.info(localize(
						'positron.viewDataFrameAtCursor.notDefined',
						"'{0}' is not a data frame defined in the active session.",
						resolution.symbol,
					));
				}
				return;
			case 'not-viewable':
				notificationService.info(localize(
					'positron.viewDataFrameAtCursor.notViewable',
					"'{0}' is not viewable in the Data Explorer.",
					resolution.symbol,
				));
				return;
			case 'ok':
				await viewVariableItem(
					resolution.sessionId,
					resolution.item,
					dataExplorerService,
					notificationService,
				);
				return;
		}
	}
}

/**
 * Arguments for {@link PositronDataExplorerViewDataFrameByVariableAction}.
 */
export interface IViewDataFrameByVariableArgs {
	readonly sessionId: string;
	readonly variableId: string;
}

/**
 * PositronDataExplorerViewDataFrameByVariableAction opens the Data Explorer for
 * an already-resolved variable, identified by its session and variable id. It
 * is the command that triggers (the code action, and later a click gesture)
 * invoke once they have resolved the symbol, so the open/focus logic lives in
 * one place and nothing has to re-resolve "the active editor cursor".
 */
export class PositronDataExplorerViewDataFrameByVariableAction extends Action2 {
	constructor() {
		super({
			id: PositronDataExplorerCommandId.ViewDataFrameByVariableAction,
			title: {
				value: localize('positronDataExplorer.viewDataFrameByVariable', 'Open in Data Explorer'),
				original: 'Open in Data Explorer'
			},
			category,
			// Not a palette command: it requires arguments that only a caller
			// (e.g. the code action) can supply.
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, args?: IViewDataFrameByVariableArgs): Promise<void> {
		if (!args?.sessionId || !args?.variableId) {
			return;
		}
		const variablesService = accessor.get(IPositronVariablesService);
		const dataExplorerService = accessor.get(IPositronDataExplorerService);
		const notificationService = accessor.get(INotificationService);

		const instance = variablesService.positronVariablesInstances.find(
			i => i.session.sessionId === args.sessionId,
		);
		const item = instance?.variableItems.find(v => v.id === args.variableId);
		if (!item) {
			// The variable went away between resolution and invocation (e.g. the
			// session reset). Nothing to view.
			return;
		}

		await viewVariableItem(
			args.sessionId,
			item,
			dataExplorerService,
			notificationService,
		);
	}
}

/**
 * Registers Positron data explorer actions.
 */
export function registerPositronDataExplorerActions() {
	registerAction2(PositronDataExplorerCopyAction);
	registerAction2(PositronDataExplorerCopyTableDataAction);
	registerAction2(PositronDataExplorerCollapseSummaryAction);
	registerAction2(PositronDataExplorerExpandSummaryAction);
	registerAction2(PositronDataExplorerSummaryOnLeftAction);
	registerAction2(PositronDataExplorerSummaryOnRightAction);
	registerAction2(PositronDataExplorerClearColumnSortingAction);
	registerAction2(PositronDataExplorerOpenAsPlaintextAction);
	registerAction2(PositronDataExplorerOpenAsSpreadsheetAction);
	registerAction2(PositronDataExplorerFileOptionsAction);
	registerAction2(PositronDataExplorerConvertToCodeAction);
	registerAction2(PositronDataExplorerConvertToCodeModalAction);
	registerAction2(PositronDataExplorerShowColumnContextMenuAction);
	registerAction2(PositronDataExplorerShowRowContextMenuAction);
	registerAction2(PositronDataExplorerShowCellContextMenuAction);
	registerAction2(PositronDataExplorerViewDataFrameAtCursorAction);
	registerAction2(PositronDataExplorerViewDataFrameByVariableAction);
}
