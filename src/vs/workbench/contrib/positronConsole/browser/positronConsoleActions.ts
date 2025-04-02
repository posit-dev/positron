/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { isString } from '../../../../base/common/types.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IEditor } from '../../../../editor/common/editorCommon.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Position } from '../../../../editor/common/core/position.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { PositronConsoleFocused } from '../../../common/contextkeys.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IStatementRange, StatementRangeProvider } from '../../../../editor/common/languages.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { NOTEBOOK_EDITOR_FOCUSED } from '../../notebook/common/notebookContextKeys.js';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronModalDialogsService } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';
import { CodeAttributionSource, IConsoleCodeAttribution, IPositronConsoleService, POSITRON_CONSOLE_VIEW_ID } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IExecutionHistoryService } from '../../../services/positronHistory/common/executionHistoryService.js';

/**
 * Positron console command ID's.
 */
const enum PositronConsoleCommandId {
	ClearConsole = 'workbench.action.positronConsole.clearConsole',
	ClearInputHistory = 'workbench.action.positronConsole.clearInputHistory',
	ExecuteCode = 'workbench.action.positronConsole.executeCode',
	FocusConsole = 'workbench.action.positronConsole.focusConsole',
	NewConsoleSession = 'workbench.action.positronConsole.newConsoleSession',
	NewConsoleSessionActiveRuntime = 'workbench.action.positronConsole.newConsoleSessionActiveRuntime'
}

/**
 * Positron console action category.
 */
const POSITRON_CONSOLE_ACTION_CATEGORY = localize('positronConsoleCategory', "Console");

/**
 * trimNewLines helper.
 * @param str The string to trim newlines for.
 * @returns The string with newlines trimmed.
 */
const trimNewlines = (str: string) => str.replace(/^\n+|\n+$/g, '');

/**
 * Registers Positron console actions.
 */
export function registerPositronConsoleActions() {
	/**
	 * The category for the actions below.
	 */
	const category: ILocalizedString = {
		value: POSITRON_CONSOLE_ACTION_CATEGORY,
		original: 'Console'
	};

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
				keybinding: {
					when: PositronConsoleFocused,
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyMod.CtrlCmd | KeyCode.KeyL,
					mac: {
						primary: KeyMod.WinCtrl | KeyCode.KeyL
					}
				},
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
	 * Register the focus console action. This action places focus in the active console,
	 * if one exists.
	 *
	 * This action is equivalent to the `workbench.panel.positronConsole.focus` command.
	 */
	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				id: PositronConsoleCommandId.FocusConsole,
				title: {
					value: localize('workbench.action.positronConsole.focusConsole', "Focus Console"),
					original: 'Focus Console'
				},
				f1: true,
				keybinding: {
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyF)
				},
				category,
			});
		}

		/**
		 * Runs action; places focus in the console's input control.
		 *
		 * @param accessor The services accessor.
		 */
		async run(accessor: ServicesAccessor) {
			const viewsService = accessor.get(IViewsService);

			// Ensure that the panel and console are visible. This is essentially
			// equivalent to what `workbench.panel.positronConsole.focus` does.
			await viewsService.openView(POSITRON_CONSOLE_VIEW_ID, true);
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
			});
		}

		/**
		 * Runs action.
		 * @param accessor The services accessor.
		 */
		run(accessor: ServicesAccessor) {
			// Use the service accessor to get the services we need.
			const executionHistoryService = accessor.get(IExecutionHistoryService);
			const notificationService = accessor.get(INotificationService);
			const positronConsoleService = accessor.get(IPositronConsoleService);
			const positronModalDialogsService = accessor.get(IPositronModalDialogsService);

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
			const languageName = activePositronConsoleInstance.runtimeMetadata.languageName;

			// Ask the user to confirm the action.
			positronModalDialogsService.showConfirmationModalDialog({
				title: localize('clearInputHistoryTitle', "Clear Input History"),
				message: localize(
					'clearInputHistoryPrompt',
					"Are you sure you want to clear the {0} input history? This can't be undone.",
					languageName
				),
				action: async () => {
					// Clear the active Positron console instance and the history for its language from the
					// execution history service.
					activePositronConsoleInstance.clearInputHistory();
					executionHistoryService.clearInputEntries(
						activePositronConsoleInstance.sessionMetadata.sessionId
					);

					// Let the user know that the history was cleared.
					notificationService.notify({
						severity: Severity.Info,
						message: localize(
							'positron.inputHistory.cleared',
							"The {0} input history has been cleared.",
							languageName
						),
						sticky: false
					});
				}
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
				precondition: ContextKeyExpr.and(
					EditorContextKeys.editorTextFocus,
					NOTEBOOK_EDITOR_FOCUSED.toNegated()
				),
				keybinding: {
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyMod.CtrlCmd | KeyCode.Enter,
					mac: {
						primary: KeyMod.CtrlCmd | KeyCode.Enter,
						secondary: [KeyMod.WinCtrl | KeyCode.Enter]
					}
				},
			});
		}

		/**
		 * Runs action.
		 * @param accessor The services accessor.
		 * @param opts Options for code execution
		 *   - allowIncomplete: Optionally, should incomplete statements be accepted? If `undefined`, treated as `false`.
		 *   - languageId: Optionally, a language override for the code to execute. If `undefined`, the language of the active text editor is used. Useful for notebooks.
		 *   - advance: Optionally, if the cursor should be advanced to the next statement. If `undefined`, fallbacks to `true`.
		 *   - mode: Optionally, the code execution mode for a language runtime. If `undefined` fallbacks to `Interactive`.
		 *   - errorBehavior: Optionally, the error behavior for a language runtime. If `undefined` fallbacks to `Continue`.
		 */
		async run(
			accessor: ServicesAccessor,
			opts: {
				allowIncomplete?: boolean;
				languageId?: string;
				advance?: boolean;
				mode?: RuntimeCodeExecutionMode;
				errorBehavior?: RuntimeErrorBehavior;
			} = {}
		) {
			// Access services.
			const editorService = accessor.get(IEditorService);
			const languageFeaturesService = accessor.get(ILanguageFeaturesService);
			const languageService = accessor.get(ILanguageService);
			const logService = accessor.get(ILogService);
			const notificationService = accessor.get(INotificationService);
			const positronConsoleService = accessor.get(IPositronConsoleService);

			// By default we advance the cursor to the next statement
			const advance = opts.advance === undefined ? true : opts.advance;

			// The code to execute.
			let code: string | undefined = undefined;

			// If there is no active editor, there is nothing to execute.
			const editor = editorService.activeTextEditorControl as IEditor;
			if (!editor) {
				return;
			}

			// Get the code to execute.
			const selection = editor.getSelection();
			const model = editor.getModel() as ITextModel;

			// If we have a selection and it isn't empty, then we use its contents (even if it
			// only contains whitespace or comments) and also retain the user's selection location.
			if (selection && !selection.isEmpty()) {
				code = model.getValueInRange(selection);
				// HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK
				// This attempts to address https://github.com/posit-dev/positron/issues/1177
				// by tacking a newline onto multiline, indented Python code fragments. This allows
				// such code fragments to be complete.
				if (editorService.activeTextEditorLanguageId === 'python') {
					const lines = code.split('\n');
					if (lines.length > 1 && /^[ \t]/.test(lines[lines.length - 1])) {
						code += '\n';
					}
				}
				// HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK
			}

			// Get the position of the cursor. If we don't have a selection, we'll use this to
			// determine the code to execute.
			const position = editor.getPosition();
			if (!position) {
				return;
			}

			// Get all the statement range providers for the active document.
			const statementRangeProviders =
				languageFeaturesService.statementRangeProvider.all(model);

			// If the user doesn't have an explicit selection, consult a statement range provider,
			// which can be used to get the code to execute.
			if (!isString(code) && statementRangeProviders.length > 0) {

				let statementRange: IStatementRange | null | undefined = undefined;
				try {
					// Just consult the first statement range provider if several are registered
					statementRange = await statementRangeProviders[0].provideStatementRange(
						model,
						position,
						CancellationToken.None);
				} catch (err) {
					// If the statement range provider throws an exception, log it and continue
					logService.warn(`Failed to get statement range at ${position}: ${err}`);
				}

				if (statementRange) {
					// If a statement was found, get the code to execute. Always use whatever the
					// range provider returns, even if it is an empty string, as it should have
					// returned `undefined` if it didn't think it was important.
					code = isString(statementRange.code) ? statementRange.code : model.getValueInRange(statementRange.range);

					if (advance) {
						await this.advanceStatement(model, editor, statementRange, statementRangeProviders[0], logService);
					}
				} else {
					// The statement range provider didn't return a range. This
					// is okay; we'll fall back to line-based execution below.
				}
			}

			// If no selection was found, use the contents of the line containing the cursor
			// position.
			if (!isString(code)) {
				const position = editor.getPosition();
				let lineNumber = position?.lineNumber ?? 0;

				if (lineNumber > 0) {
					// Find the first non-empty line after the cursor position and read the
					// contents of that line.
					for (let number = lineNumber; number <= model.getLineCount(); ++number) {
						const temp = trimNewlines(model.getLineContent(number));

						if (temp.length > 0) {
							code = temp;
							lineNumber = number;
							break;
						}
					}
				}

				// If we have code and a position move the cursor to the next line with code on it,
				// or just to the next line if all additional lines are blank.
				if (advance && isString(code) && position) {
					this.advanceLine(model, editor, position, lineNumber, code, editorService);
				}

				if (!isString(code) && position && lineNumber === model.getLineCount()) {
					// If we still don't have code and we are at the end of the document, add a
					// newline to the end of the document.
					this.amendNewlineToEnd(model);

					// We don't move to that new line to avoid adding a bunch of empty
					// lines to the end. The edit operation typically moves us to the new line,
					// so we have to undo that.
					const newPosition = new Position(lineNumber, 1);
					editor.setPosition(newPosition);
					editor.revealPositionInCenterIfOutsideViewport(newPosition);
				}

				// If we still don't have code after looking at the cursor position,
				// execute an empty string.
				if (!isString(code)) {
					code = '';
				}
			}

			// Now that we've gotten this far, ensure we have a target language.
			const languageId = opts.languageId ? opts.languageId : editorService.activeTextEditorLanguageId;
			if (!languageId) {
				notificationService.notify({
					severity: Severity.Info,
					message: localize('positron.executeCode.noLanguage', "Cannot execute code. Unable to detect input language."),
					sticky: false
				});
				return;
			}

			// Whether to allow incomplete code to be executed.
			// By default, we don't allow incomplete code to be executed, but the language runtime can override this.
			// This means that if allowIncomplete is false or undefined, the incomplete code will not be sent to the backend for execution.
			// The console will continue to wait for more input until the user completes the code, or cancels out of the operation.
			const allowIncomplete = opts.allowIncomplete;


			// Create the attribution object. This is used to track the source of the code execution.
			const attribution: IConsoleCodeAttribution = {
				source: CodeAttributionSource.Script,
				metadata: {
					file: model.uri.path,
					position: {
						line: position.lineNumber,
						column: position.column
					},
				}
			};

			// Ask the Positron console service to execute the code. Do not focus the console as
			// this will rip focus away from the editor.
			if (!await positronConsoleService.executeCode(
				languageId, code, attribution, false, allowIncomplete, opts.mode, opts.errorBehavior)) {
				const languageName = languageService.getLanguageName(languageId);
				notificationService.notify({
					severity: Severity.Info,
					message: localize('positron.executeCode.noRuntime', "Cannot execute code. Unable to start a runtime for the {0} language.", languageName),
					sticky: false
				});
			}
		}

		async advanceStatement(
			model: ITextModel,
			editor: IEditor,
			statementRange: IStatementRange,
			provider: StatementRangeProvider,
			logService: ILogService,
		) {

			// Move the cursor to the next
			// statement by creating a position on the line
			// following the statement and then invoking the
			// statement range provider again to find the appropriate
			// boundary of the next statement.
			let newPosition = new Position(
				statementRange.range.endLineNumber + 1,
				1
			);

			if (newPosition.lineNumber > model.getLineCount()) {
				// If the new position is past the end of the
				// document, add a newline to the end of the
				// document, unless it already ends with an empty
				// line, then move to that empty line at the end.
				if (model.getLineContent(model.getLineCount()).trim().length > 0) {
					// The document doesn't end with an empty line; add one
					this.amendNewlineToEnd(model);
				}
				newPosition = new Position(
					model.getLineCount(),
					1
				);
				editor.setPosition(newPosition);
				editor.revealPositionInCenterIfOutsideViewport(newPosition);
			} else {
				// Invoke the statement range provider again to
				// find the appropriate boundary of the next statement.

				let nextStatementRange: IStatementRange | null | undefined = undefined;
				try {
					nextStatementRange = await provider.provideStatementRange(
						model,
						newPosition,
						CancellationToken.None);
				} catch (err) {
					logService.warn(`Failed to get statement range for next statement ` +
						`at position ${newPosition}: ${err}`);
				}

				if (nextStatementRange) {
					// If we found the next statement, determine exactly where to move
					// the cursor to, maintaining the invariant that we should always
					// step further down the page, never up, as this is too "jumpy".
					// If for some reason the next statement doesn't meet this
					// invariant, we don't use it and instead use the default
					// `newPosition`.
					const nextStatement = nextStatementRange.range;
					if (nextStatement.startLineNumber > statementRange.range.endLineNumber) {
						// If the next statement's start is after this statement's end,
						// then move to the start of the next statement.
						newPosition = new Position(
							nextStatement.startLineNumber,
							nextStatement.startColumn
						);
					} else if (nextStatement.endLineNumber > statementRange.range.endLineNumber) {
						// If the above condition failed, but the next statement's end
						// is after this statement's end, assume we are exiting some
						// nested scope (like running an individual line of an R
						// function) and move to the end of the next statement.
						newPosition = new Position(
							nextStatement.endLineNumber,
							nextStatement.endColumn
						);
					}
				}

				editor.setPosition(newPosition);
				editor.revealPositionInCenterIfOutsideViewport(newPosition);
			}
		}

		advanceLine(
			model: ITextModel,
			editor: IEditor,
			position: Position,
			lineNumber: number,
			code: string,
			editorService: IEditorService,
		) {
			// HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK
			// This attempts to address https://github.com/posit-dev/positron/issues/1177
			// by tacking a newline onto indented Python code fragments that end at an empty
			// line. This allows such code fragments to be complete.
			if (editorService.activeTextEditorLanguageId === 'python' &&
				/^[ \t]/.test(code) &&
				lineNumber + 1 <= model.getLineCount() &&
				model.getLineContent(lineNumber + 1) === '') {
				code += '\n';
			}
			// HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK HACK

			let onlyEmptyLines = true;

			for (let number = lineNumber + 1; number <= model.getLineCount(); ++number) {
				if (trimNewlines(model.getLineContent(number)).length !== 0) {
					// We found a non-empty line, move the cursor to it.
					onlyEmptyLines = false;
					lineNumber = number;
					break;
				}
			}

			if (onlyEmptyLines) {
				// At a minimum, we always move the cursor 1 line past the code we executed
				// so the user can keep typing
				++lineNumber;

				if (lineNumber === model.getLineCount() + 1) {
					// If this puts us past the end of the document, insert a newline for us
					// to move to
					this.amendNewlineToEnd(model);
				}
			}

			const newPosition = position.with(lineNumber, 0);
			editor.setPosition(newPosition);
			editor.revealPositionInCenterIfOutsideViewport(newPosition);
		}

		amendNewlineToEnd(model: ITextModel) {
			// Typically we don't do anything when we don't have code to execute,
			// but when we are at the end of a document we add a new line.
			// This edit operation also moves the cursor to the new line if the cursor
			// was already at the end of the document. This may or may not be desirable
			// depending on the context.
			const editOperation = {
				range: {
					startLineNumber: model.getLineCount(),
					startColumn: model.getLineMaxColumn(model.getLineCount()),
					endLineNumber: model.getLineCount(),
					endColumn: model.getLineMaxColumn(model.getLineCount())
				},
				text: '\n'
			};
			model.pushEditOperations([], [editOperation], () => []);
		}
	});
}
