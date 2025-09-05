/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../browser/editorBrowser.js';
import { EditorAction, registerEditorAction, ServicesAccessor } from '../../../browser/editorExtensions.js';
import { ISingleEditOperation } from '../../../common/core/editOperation.js';
import * as nls from '../../../../nls.js';
import { IPosition } from '../../../common/core/position.js';
import { Range } from '../../../common/core/range.js';
import { Selection } from '../../../common/core/selection.js';
import { ICommand, ICursorStateComputerData, IEditOperationBuilder } from '../../../common/editorCommon.js';
import { EditorContextKeys } from '../../../common/editorContextKeys.js';
import { ILanguageConfigurationService } from '../../../common/languages/languageConfigurationRegistry.js';
import { ITextModel } from '../../../common/model.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IsDevelopmentContext } from '../../../../platform/contextkey/common/contextkeys.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
import { ReplaceCommand } from '../../../common/commands/replaceCommand.js';

interface IPositronCommentMarkers {
	startText: string;
	endText: string;
}

function inferCommentMarkers(accessor: ServicesAccessor, editor: ICodeEditor): IPositronCommentMarkers {

	const defaultCommentMarkers = <IPositronCommentMarkers>{
		startText: '// --- Start Positron ---',
		endText: '// --- End Positron ---',
	};

	const languageId = editor.getModel()?.getLanguageId();
	if (!languageId) {
		return defaultCommentMarkers;
	}

	const languageConfigurationService = accessor.get(ILanguageConfigurationService);
	const languageConfiguration = languageConfigurationService.getLanguageConfiguration(languageId);
	const comments = languageConfiguration.comments;
	if (!comments) {
		return defaultCommentMarkers;
	}

	const lineCommentToken = comments.lineCommentToken;
	if (lineCommentToken) {
		return <IPositronCommentMarkers>{
			startText: `${lineCommentToken} --- Start Positron ---`,
			endText: `${lineCommentToken} --- End Positron ---`,
		};
	}

	const startToken = comments.blockCommentStartToken;
	const endToken = comments.blockCommentEndToken;
	if (startToken && endToken) {
		return <IPositronCommentMarkers>{
			startText: `${startToken} --- Start Positron --- ${endToken}`,
			endText: `${startToken} --- End Positron --- ${endToken}`,
		};
	}

	return defaultCommentMarkers;

}

function addPositronCommentMarkers(model: ITextModel, selection: Selection, markers: IPositronCommentMarkers): ISingleEditOperation[] {

	// Compute the start position.
	const startPosition = <IPosition>{
		lineNumber: selection.selectionStartLineNumber,
		column: 0,
	};

	// Compute the end position.
	const endPosition = <IPosition>{
		lineNumber: selection.endLineNumber,
		column: Infinity,
	};

	// Inherit the indentation from the first line.
	const startLine = model.getLineContent(startPosition.lineNumber);
	const indent = /^\s*/.exec(startLine)?.[0];

	// Return the actions to insert text around the selection.
	return [
		{
			range: Range.fromPositions(startPosition, startPosition),
			text: `${indent}${markers.startText}\n`,
		},
		{
			range: Range.fromPositions(endPosition, endPosition),
			text: `\n${indent}${markers.endText}`,
		},
	];

}


export class AddPositronCommentMarkersCommand implements ICommand {

	private readonly _selection: Selection;
	private readonly _markers: IPositronCommentMarkers;
	private _selectionId: string | null;

	constructor(selection: Selection, markers: IPositronCommentMarkers) {
		this._selection = selection;
		this._markers = markers;
		this._selectionId = null;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		const ops = addPositronCommentMarkers(model, this._selection, this._markers);
		for (const op of ops) {
			builder.addTrackedEditOperation(op.range, op.text);
		}
		this._selectionId = builder.trackSelection(this._selection);
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		return helper.getTrackedSelection(this._selectionId!);
	}

}

export class AddPositronCommentMarkersAction extends EditorAction {

	public static readonly ID = 'editor.action.addPositronCommentMarkers';

	constructor() {
		super({
			id: AddPositronCommentMarkersAction.ID,
			label: 'Positron: Add Positron Comment Markers',
			alias: 'Positron: Add Positron Comment Markers',
			precondition: ContextKeyExpr.and(IsDevelopmentContext, EditorContextKeys.writable),
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void {

		const selection = editor.getSelection();
		if (selection === null) {
			return;
		}

		const commentMarkers = inferCommentMarkers(accessor, editor);
		const command = new AddPositronCommentMarkersCommand(selection, commentMarkers);

		editor.pushUndoStop();
		editor.executeCommands(this.id, [command]);
		editor.pushUndoStop();
	}
}

/**
 * Fills from the cursor position to the end of the line with a symbol
 * character, e.g.
 *
 * // foo-bar
 * =>
 * // foo-bar ------------------------------------------------------------------
 *
 * By default, uses '-' as the fill character and fills to column 80, but tries
 * to be smart-ish:
 *
 * - If the character to the left of the cursor is a symbol, fills with that instead of
 *   a dash
 * - If you've defined a margin column, fills to there instead of to column 80
 * - Can override with command arguments
 *
 */
export class FillToEndOfLineAction extends EditorAction {

	public static readonly ID = 'editor.fillToEndOfLine';

	constructor() {
		super({
			id: FillToEndOfLineAction.ID,
			label: nls.localize2('positron.fillToEndOfline', 'Fill Symbol to End of Line'),
			precondition: EditorContextKeys.writable,
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void {
		const model = editor.getModel();
		if (!model) {
			return;
		}

		const selections = editor.getSelections();
		if (!selections || selections.length === 0) {
			return;
		}

		const commands: ICommand[] = [];
		const parsedArgs = this.parseArgs(args);

		for (const selection of selections) {
			const position = selection.getStartPosition();
			const lineNumber = position.lineNumber;
			const currentColumn = position.column;
			const lineContent = model.getLineContent(lineNumber);

			// Determine fill character
			const fillChar = this.determineFillCharacter(parsedArgs.fillCharacter, lineContent, currentColumn);

			// Determine target column
			const targetColumn = this.determineTargetColumn(parsedArgs.column, editor);

			// Only fill if target column is greater than current position
			if (targetColumn > currentColumn) {
				const fillLength = targetColumn - currentColumn;
				const fillString = fillChar.repeat(fillLength + 1) + '\n';

				commands.push(new ReplaceCommand(new Range(lineNumber, currentColumn, lineNumber, currentColumn), fillString));
			}
		}

		if (commands.length > 0) {
			editor.pushUndoStop();
			editor.executeCommands(this.id, commands);
			editor.pushUndoStop();
		}
	}

	private parseArgs(args: unknown): { fillCharacter?: string; column?: number } {
		if (typeof args === 'object' && args !== null) {
			const argsObj = args as any;
			return {
				fillCharacter: typeof argsObj.fillCharacter === 'string' ? argsObj.fillCharacter : undefined,
				column: typeof argsObj.column === 'number' ? argsObj.column : undefined
			};
		}
		return {};
	}

	private determineFillCharacter(providedChar: string | undefined, lineContent: string, currentColumn: number): string {
		if (providedChar) {
			return providedChar;
		}

		// Check character to the left of cursor
		if (currentColumn > 1) {
			const charToLeft = lineContent.charAt(currentColumn - 2); // -2 because column is 1-based and charAt is 0-based
			if (this.isSymbol(charToLeft)) {
				return charToLeft;
			}
		}

		// Default to dash
		return '-';
	}

	private isSymbol(char: string): boolean {
		// Check if character is a symbol (non-alphanumeric, non-whitespace)
		return /^[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?`~]$/.test(char);
	}

	private determineTargetColumn(providedColumn: number | undefined, editor: ICodeEditor): number {
		if (providedColumn !== undefined) {
			return providedColumn;
		}

		// Try to get ruler columns from editor options
		const rulers = editor.getOption(EditorOption.rulers);
		if (rulers && rulers.length > 0) {
			// Find the first ruler column that's a number
			for (const ruler of rulers) {
				if (typeof ruler === 'number') {
					return ruler;
				}
				if (typeof ruler === 'object' && ruler !== null && typeof ruler.column === 'number') {
					return ruler.column;
				}
			}
		}

		// Try to get word wrap column
		const wrappingInfo = editor.getOption(EditorOption.wrappingInfo);
		if (wrappingInfo && wrappingInfo.wrappingColumn > 0) {
			return wrappingInfo.wrappingColumn;
		}

		// Default to 80
		return 80;
	}
}

registerEditorAction(AddPositronCommentMarkersAction);
registerEditorAction(FillToEndOfLineAction);
