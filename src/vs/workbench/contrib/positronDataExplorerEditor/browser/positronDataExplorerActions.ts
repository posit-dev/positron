/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { DEFAULT_EDITOR_ASSOCIATION, EditorResourceAccessor, IEditorPane } from '../../../common/editor.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { PositronDataExplorerFocused } from '../../../common/contextkeys.js';
import { IsDevelopmentContext } from '../../../../platform/contextkey/common/contextkeys.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IPositronDataExplorerEditor } from './positronDataExplorerEditor.js';
import { IPositronDataExplorerService, PositronDataExplorerLayout } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { PositronDataExplorerEditorInput } from './positronDataExplorerEditorInput.js';
import { POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR, POSITRON_DATA_EXPLORER_IS_COLUMN_SORTING, POSITRON_DATA_EXPLORER_IS_PLAINTEXT, POSITRON_DATA_EXPLORER_LAYOUT } from './positronDataExplorerContextKeys.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { PositronDataExplorerUri } from '../../../services/positronDataExplorer/common/positronDataExplorerUri.js';
import { URI } from '../../../../base/common/uri.js';
import { EditorOpenSource } from '../../../../platform/editor/common/editor.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { toLocalResource } from '../../../../base/common/resources.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';

/**
 * Positron data explorer action category.
 */
const POSITRON_DATA_EXPLORER_ACTION_CATEGORY = localize(
	'positronDataExplorerCategory',
	"Positron Data Explorer"
);

/**
 * The category for the actions below.
 */
const category: ILocalizedString = {
	value: POSITRON_DATA_EXPLORER_ACTION_CATEGORY,
	original: 'Positron Data Explorer'
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
	OpenAsPlaintext = 'workbench.action.positronDataExplorer.openAsPlaintext'
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
				PositronDataExplorerFocused
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
			precondition: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR
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
			precondition: POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR
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
			displayTitleOnActionBar: true,
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
 * PositronDataExplorerOpenAsPlaintextAction action.
 */
class PositronDataExplorerOpenAsPlaintextAction extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronDataExplorerCommandId.OpenAsPlaintext,
			title: {
				value: localize('positronDataExplorer.openAsPlaintext', 'Open as Plain Text File'),
				original: 'Open as Plain Text File'
			},
			displayTitleOnActionBar: true,
			category,
			f1: true,
			precondition: ContextKeyExpr.and(
				POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
				POSITRON_DATA_EXPLORER_IS_PLAINTEXT
			),
			icon: Codicon.fileText,
			menu: [
				{
					id: MenuId.EditorActionsLeft,
					when: ContextKeyExpr.and(
						POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
						POSITRON_DATA_EXPLORER_IS_PLAINTEXT
					)
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
		// Access the services we need.
		const pathService = accessor.get(IPathService);
		const environmentService = accessor.get(IWorkbenchEnvironmentService);
		const editorService = accessor.get(IEditorService);

		// Grab Data Explorer URI (scheme = positron-data-explorer)
		const originalURI = EditorResourceAccessor.getOriginalUri(editorService.activeEditor);
		if (!originalURI) {
			return;
		}

		// Parse this URI - gives underlying FS URI if not memory-backed (scheme = duckdb)
		const parsedDataExplorerURI = PositronDataExplorerUri.parse(originalURI);
		if (!parsedDataExplorerURI) {
			return;
		}

		// Convert raw duckdb URI to appropriate file URI (scheme = file if local, vscode-remote if server)
		const localURI = toLocalResource(
			URI.parse(parsedDataExplorerURI),
			environmentService.remoteAuthority,
			pathService.defaultUriScheme
		);

		// Invoke editor for file, using default editor (text) association
		await editorService.openEditor({
			resource: localURI,
			options: {
				override: DEFAULT_EDITOR_ASSOCIATION.id,
				source: EditorOpenSource.USER
			}
		});
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
}
