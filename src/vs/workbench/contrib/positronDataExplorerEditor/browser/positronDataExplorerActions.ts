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
				message: localize('positron.dataExplorer.noActiveEditor', "Cannot copy. A Positron Data Explorer is not active."),
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

		// Copy to the clipboard.
		await positronDataExplorerInstance.copyToClipboard();
	}
}

/**
 * Registers Positron data explorer actions.
 */
export function registerPositronDataExplorerActions() {
	registerAction2(PositronDataExplorerCopyAction);
}
