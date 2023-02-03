/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { ITextModel } from 'vs/editor/common/model';
import { IEditor } from 'vs/editor/common/editorCommon';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/common/positronConsole';
import { PositronConsoleCommandId, POSITRON_CONSOLE_ACTION_CATEGORY } from 'vs/workbench/contrib/positronConsole/common/positronConsole';
import { ILanguageService } from 'vs/editor/common/languages/language';

/**
 * Registers Positron console actions.
 */
export function registerPositronConsoleActions() {
	/**
	 * The category for the actions below.
	 */
	const category: ILocalizedString = { value: POSITRON_CONSOLE_ACTION_CATEGORY, original: 'CONSOLE' };

	/**
	 * Register the clear console action. This action removes everything from the active console, just like
	 * running the clear command in a shell.
	 */
	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				id: PositronConsoleCommandId.Clear,
				title: {
					value: localize('workbench.action.positronConsole.clearConsole', "Clear Console"),
					original: 'Clear Console'
				},
				f1: true,
				category,
				//icon: Codicon.?
				keybinding: {
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyMod.CtrlCmd | KeyCode.KeyL
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
				positronConsoleService.activePositronConsoleInstance.clear();
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
	 * Register the execute code action. This action gets the selection or line from the active editor, determines
	 * the language of the code that is selected, and tries to execute it.
	 */
	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				id: PositronConsoleCommandId.Send,
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
			const notificationService = accessor.get(INotificationService);

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
					// If there is an active selection, use the contents of the selection to drive execution.
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

			// If there is no code to execute, inform the user.
			if (code.length === 0) {
				notificationService.notify({
					severity: Severity.Info,
					message: localize('positron.executeCode.noCode', "No code is selected or available to execute."),
					sticky: false
				});
				return;
			}

			// Now that we've gotten this far, and there's "code" to ececute, ensure we have a target language.
			const languageId = editorService.activeTextEditorLanguageId;
			if (!languageId) {
				notificationService.notify({
					severity: Severity.Info,
					message: localize('positron.executeCode.noLanguage', "Cannot execute code. Unable to detect input language."),
					sticky: false
				});
				return;
			}

			// Ask the Positron console service to execute the code.
			const positronConsoleService = accessor.get(IPositronConsoleService);
			if (!positronConsoleService.executeCode(languageId, code)) {
				const languageService = accessor.get(ILanguageService);
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
