/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IEditorPane } from 'vs/workbench/common/editor';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { PositronDataExplorerFocused } from 'vs/workbench/common/contextkeys';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IPositronDataExplorerEditor } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerEditor';
import { IPositronDataExplorerService } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';
import { PositronDataExplorerEditorInput } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerEditorInput';

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
}

/**
 * A ContextKeyExpression that is true when the active editor is a Positron data explorer editor.
 */
export const POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR = ContextKeyExpr.equals(
	'activeEditor',
	PositronDataExplorerEditorInput.EditorID
);

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
				message: localize('positron.dataExplorer.copy.noActiveEditor', "Cannot copy. A Positron Data Explorer is not active."),
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
				message: localize('positron.dataExplorer.copyTableData.noActiveEditor', "Cannot copy table data. A Positron Data Explorer is not active."),
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
				message: localize('positron.dataExplorer.collapseSummary.noActiveEditor', "Cannot Collapse Summary. A Positron Data Explorer is not active."),
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
				message: localize('positron.dataExplorer.expandSummary.noActiveEditor', "Cannot Expand Summary. A Positron Data Explorer is not active."),
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
 * Registers Positron data explorer actions.
 */
export function registerPositronDataExplorerActions() {
	registerAction2(PositronDataExplorerCopyAction);
	registerAction2(PositronDataExplorerCopyTableDataAction);
	registerAction2(PositronDataExplorerCollapseSummaryAction);
	registerAction2(PositronDataExplorerExpandSummaryAction);
}
