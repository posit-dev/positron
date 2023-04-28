/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';
import { ITextModel } from 'vs/editor/common/model';
import { IEditor } from 'vs/editor/common/editorCommon';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { confirmationModalDialog } from 'vs/workbench/browser/positronModalDialogs/confirmationModalDialog';
import { IExecutionHistoryService } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';
import { IViewsService } from 'vs/workbench/common/views';
import { PositronConsoleViewPane } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleView';

/**
 * Positron console command ID's.
 */
const enum PositronConsoleCommandId {
	ClearConsole = 'workbench.action.positronConsole.clearConsole',
	ClearInputHistory = 'workbench.action.positronConsole.clearInputHistory',
	ExecuteCode = 'workbench.action.positronConsole.executeCode'
}

/**
 * Positron console action category.
 */
const POSITRON_CONSOLE_ACTION_CATEGORY = localize('positronConsoleCategory', "Console");

/**
 * The Positron console view ID.
 */
export const POSITRON_CONSOLE_VIEW_ID = 'workbench.panel.positronConsole';

/**
 * Registers Positron console actions.
 */
export function registerPositronConsoleActions() {
	/**
	 * The category for the actions below.
	 */
	const category: ILocalizedString = { value: POSITRON_CONSOLE_ACTION_CATEGORY, original: 'CONSOLE' };

	/**
	 * Register the clear console action. This action removes everything from the active console,
	 * just like running the clear command in a shell.
	 */
	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				id: PositronConsoleCommandId.ClearConsole,
				title: {
					value: localize('workbench.action.positronConsole.clearConsole', "Clear Console"),
					original: 'Clear Console'
				},
				f1: true,
				category,
				//icon: Codicon.?
				keybinding: {
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyMod.WinCtrl | KeyCode.KeyL
				},
				description: {
					description: 'workbench.action.positronConsole.clearConsole',
					args: []
				}
			});
		}

		/**
		 * Runs action.
		 * @param accessor The services accessor.
		 */
		async run(accessor: ServicesAccessor) {
			// If there is an active console, clear it. Otherwise, inform the user.
			const positronConsoleService = accessor.get(IPositronConsoleService);
			if (positronConsoleService.activePositronConsoleInstance) {
				positronConsoleService.activePositronConsoleInstance.clearConsole();
			} else {
				accessor.get(INotificationService).notify({
					severity: Severity.Info,
					message: localize('positron.clearConsole.noActiveConsole', "Cannot clear console. A console is not active."),
					sticky: false
				});
			}
		}
	});

	/**
	 * Register the clear input history action. This action removes everything from the active
	 * console language's input history.
	 */
	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				id: PositronConsoleCommandId.ClearInputHistory,
				title: {
					value: localize('workbench.action.positronConsole.clearInputHistory', "Clear Input History"),
					original: 'Clear Input History'
				},
				f1: true,
				category,
				icon: Codicon.clearAll,
				description: {
					description: 'workbench.action.positronConsole.clearInputHistory',
					args: []
				}
			});
		}

		/**
		 * Runs action.
		 * @param accessor The services accessor.
		 */
		async run(accessor: ServicesAccessor) {
			// Use the service accessor to get the services we need.
			const executionHistoryService = accessor.get(IExecutionHistoryService);
			const positronConsoleService = accessor.get(IPositronConsoleService);
			const notificationService = accessor.get(INotificationService);
			const layoutService = accessor.get(IWorkbenchLayoutService);

			// Get the active Positron console instance. The Clear Input History action is bound to
			// the active console, so if there isn't an active Positron console instance, we can't
			// proceed.
			const activePositronConsoleInstance = positronConsoleService.activePositronConsoleInstance;
			if (!activePositronConsoleInstance) {
				notificationService.notify({
					severity: Severity.Info,
					message: localize('positron.inputHistory.noActiveConsole', "Cannot clear input history. A console is not active."),
					sticky: false
				});
				return;
			}

			// Get the language name.
			const languageName = activePositronConsoleInstance.runtime.metadata.languageName;

			// Ask the user to confirm the action.
			if (!await confirmationModalDialog(
				layoutService,
				localize('clearInputHistoryTitle', "Clear Input History"),
				localize('clearInputHistoryPrompt', "Are you sure you want to clear the {0} input history? This can't be undone.", languageName))) {
				return;
			}

			// Clear the active Positron console instance and the history for its language from the
			// execution history service.
			activePositronConsoleInstance.clearInputHistory();
			executionHistoryService.clearInputEntries(activePositronConsoleInstance.runtime.metadata.languageId);

			// Let the user know that the history was cleared.
			notificationService.notify({
				severity: Severity.Info,
				message: localize('positron.inputHistory.cleared', "The {0} input history has been cleared.", languageName),
				sticky: false
			});
		}
	});

	/**
	 * Register the execute code action. This action gets the selection or line from the active
	 * editor, determines the language of the code that is selected, and tries to execute it.
	 */
	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				id: PositronConsoleCommandId.ExecuteCode,
				title: {
					value: localize('workbench.action.positronConsole.executeCode', "Execute Code"),
					original: 'Execute Code'
				},
				f1: true,
				category,
				//icon: Codicon.?,
				keybinding: {
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyMod.CtrlCmd | KeyCode.Enter,
					win: {
						primary: KeyMod.WinCtrl | KeyCode.Enter
					}
				},
				description: {
					description: 'workbench.action.positronConsole.executeCode',
					args: []
				}
			});
		}

		/**
		 * Runs action.
		 * @param accessor The services accessor.
		 */
		async run(accessor: ServicesAccessor) {
			// Access services.
			const editorService = accessor.get(IEditorService);
			const languageService = accessor.get(ILanguageService);
			const notificationService = accessor.get(INotificationService);
			const positronConsoleService = accessor.get(IPositronConsoleService);
			const viewsService = accessor.get(IViewsService);

			// The code to execute.
			let code = '';

			// If there is an active editor, get the code to execute.
			const editor = editorService.activeTextEditorControl as IEditor;
			if (editor) {
				// Get the code to execute.
				const selection = editor.getSelection();
				const position = editor.getPosition();
				const model = editor.getModel() as ITextModel;
				if (selection) {
					// If there is an active selection, use the contents of the selection to drive
					// execution.
					code = model.getValueInRange(selection);
					if (!code.length) {
						// When there's no selection, the selection represents the
						// cursor position; just get the line at the cursor point.
						//
						// TODO: This would benefit from a "Run Current Statement"
						// behavior, but that requires deep knowledge of the
						// language's grammar. Is this something we can fit into the
						// LSP model or build into the language pack extensibility
						// point?
						code = model.getLineContent(selection.startLineNumber);
						if (code.length && position) {
							// Advance the cursor to the next line after executing
							// the current one.
							editor.setPosition(position.with(position.lineNumber + 1));
						}
					}
				} else if (position) {
					code = model.getLineContent(position.lineNumber);
					if (code.length) {
						editor.setPosition(position.with(position.lineNumber + 1));
					}
				}
			}

			// Trim the code by removing all leading and trailing newlines.
			code = code.replace(/^\n+/, '').replace(/\n+$/, '');

			// If there is no code to execute, inform the user.
			if (code.length === 0) {
				notificationService.notify({
					severity: Severity.Info,
					message: localize('positron.executeCode.noCode', "No code is selected or available to execute."),
					sticky: false
				});
				return;
			}

			// Now that we've gotten this far, and there's "code" to ececute, ensure we have a
			// target language.
			const languageId = editorService.activeTextEditorLanguageId;
			if (!languageId) {
				notificationService.notify({
					severity: Severity.Info,
					message: localize('positron.executeCode.noLanguage', "Cannot execute code. Unable to detect input language."),
					sticky: false
				});
				return;
			}

			// Ask the views service to open the view.
			await viewsService.openView<PositronConsoleViewPane>(POSITRON_CONSOLE_VIEW_ID, false);

			// Ask the Positron console service to execute the code.
			if (!positronConsoleService.executeCode(languageId, code)) {
				const languageName = languageService.getLanguageName(languageId);
				notificationService.notify({
					severity: Severity.Info,
					message: localize('positron.executeCode.noRuntime', "Cannot execute code. Unable to start a runtime for the {0} language.", languageName),
					sticky: false
				});
			}
		}
	});
}
