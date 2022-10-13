/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import { ReplCommandId, REPL_ACTION_CATEGORY } from 'vs/workbench/contrib/repl/common/repl';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Codicon } from 'vs/base/common/codicons';
import { ICreateReplOptions, IReplService } from 'vs/workbench/contrib/repl/browser/repl';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ILogService } from 'vs/platform/log/common/log';
import { IEditor } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';

export function registerReplActions() {
	const category: ILocalizedString = { value: REPL_ACTION_CATEGORY, original: 'REPL' };

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: ReplCommandId.New,
				title: { value: localize('workbench.action.repl.new', "Create New REPL"), original: 'Create New REPL' },
				f1: true,
				category,
				// TODO: Do we need to add the 'precondition' key here? Is there any context
				// in which the REPL would be unsupported?
				icon: Codicon.plus,
				// TODO: Add 'keybinding' member with a default keybinding
				description: {
					description: 'workbench.action.repl.new',
					args: [{
						name: 'options',
						schema: {
							type: 'object'
						}
					}]
				}
			});
		}

		/**
		 * Runs the repl.new command to create a new REPL instance.
		 *
		 * @param accessor The service accessor.
		 * @param options The options for the new REPL instance.
		 */
		async run(accessor: ServicesAccessor, options?: ICreateReplOptions | undefined) {
			const replService = accessor.get(IReplService);
			await replService.createRepl(options);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: ReplCommandId.Clear,
				title: { value: localize('workbench.action.repl.clear', "Clear REPL"), original: 'Clear REPL' },
				f1: true,
				category,
				icon: Codicon.plus,
				description: {
					description: 'workbench.action.repl.clear',
					args: []
				}
			});
		}

		/**
		 * Runs the repl.clear command to clear the REPL instance.
		 *
		 * @param accessor The service accessor.
		 */
		async run(accessor: ServicesAccessor) {
			const replService = accessor.get(IReplService);
			await replService.clearActiveRepl();
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: ReplCommandId.Send,
				title: { value: localize('workbench.action.repl.send', "Send to REPL"), original: 'Send to REPL' },
				f1: true,
				category,
				icon: Codicon.plus,
				description: {
					description: 'workbench.action.repl.send',
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

			const replService = accessor.get(IReplService);
			replService.executeCode(language, code);
		}
	});
}
