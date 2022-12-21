/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, registerEditorAction, ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { ISingleEditOperation } from 'vs/editor/common/core/editOperation';
import { IPosition } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICommand, ICursorStateComputerData, IEditOperationBuilder } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ILanguageConfigurationService } from 'vs/editor/common/languages/languageConfigurationRegistry';
import { ITextModel } from 'vs/editor/common/model';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';

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

registerEditorAction(AddPositronCommentMarkersAction);
