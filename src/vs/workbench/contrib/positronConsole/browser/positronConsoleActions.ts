/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';
import { ITextModel } from 'vs/editor/common/model';
import { IEditor } from 'vs/editor/common/editorCommon';
import { ILogService } from 'vs/platform/log/common/log';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { PositronConsoleCommandId, POSITRON_CONSOLE_ACTION_CATEGORY } from 'vs/workbench/contrib/positronConsole/common/positronConsole';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/common/positronConsole';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import Severity from 'vs/base/common/severity';

/**
 * Registers Positron console actions.
 */
export function registerPositronConsoleActions() {
	const category: ILocalizedString = { value: POSITRON_CONSOLE_ACTION_CATEGORY, original: 'CONSOLE' };

	/**
	 * Register the clear console action. This action removes everything from the active console, just like
	 * running the clear command in a shell.
	 */
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: PositronConsoleCommandId.Clear,
				title: { value: localize('workbench.action.positronConsole.clear', "Clear Console"), original: 'Clear Console' },
				f1: true,
				category,
				icon: Codicon.plus,
				description: {
					description: 'workbench.action.positronConsole.clear',
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
			const positronConsoleService = accessor.get(IPositronConsoleService);

			// Clear the console.
			if (positronConsoleService.activeInstance) {
				positronConsoleService.activeInstance.clear();
			} else {
				// Warn the user.
				// TODO@softwarenerd - Use a React dialog for this.
				const dialogService = accessor.get(IDialogService);
				await dialogService.show(
					Severity.Info,
					localize('noLanguageRuntime', "Cannot clear console because no interpreter is currently active."));
				return;
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: PositronConsoleCommandId.Send,
				title: { value: localize('workbench.action.positronConsole.send', "Send to Active Console"), original: 'Send to Active Console' },
				f1: true,
				category,
				icon: Codicon.plus,
				description: {
					description: 'workbench.action.positronConsole.send',
					args: []
				}
			});
		}

		/**
		 * Runs the repl.send command to send the current selection, line, or
		 * statement to the REPL
		 *
		 * @param accessor The service accessor.
		 * @param options The options for the new REPL instance.
		 */
		async run(accessor: ServicesAccessor) {
			const editorService = accessor.get(IEditorService);
			const logService = accessor.get(ILogService);

			// Ensure an editor is open to read from
			const editor = editorService.activeTextEditorControl as IEditor;
			if (!editor) {
				logService.warn('Attempt to run selection without an open editor');
				return;
			}

			// Ensure we have a target language
			const language = editorService.activeTextEditorLanguageId;
			if (!language) {
				logService.warn('Attempt to run selection without a discernable input language');
				return;
			}

			let code = '';
			const selection = editor.getSelection();
			const position = editor.getPosition();
			const model = editor.getModel() as ITextModel;
			if (selection) {
				// If there is an active selection, use the contents of the
				// selection to drive execution
				code = model.getValueInRange(selection);
				if (code.length === 0) {
					// When there's no selection, the selection represents the
					// cursor position; just get the line at the cursor point.
					//
					// TODO: This would benefit from a "Run Current Statement"
					// behavior, but that requires deep knowledge of the
					// language's grammar. Is this something we can fit into the
					// LSP model or build into the language pack extensibility
					// point?
					code = model.getLineContent(selection.startLineNumber);
					if (position) {
						// Advance the cursor to the next line after executing
						// the current one.
						editor.setPosition(position.with(position.lineNumber + 1));
					}
				}
			} else {
				// Fallback for case wherein there is no selection; just use
				// cursor position
				if (position) {
					code = model.getLineContent(position.lineNumber);
					editor.setPosition(position.with(position.lineNumber + 1));
				} else {
					logService.warn('Cannot determine location of cursor for running current line');
				}
			}

			const positronConsoleService = accessor.get(IPositronConsoleService);
			positronConsoleService.executeCode(language, code);
		}
	});
}
