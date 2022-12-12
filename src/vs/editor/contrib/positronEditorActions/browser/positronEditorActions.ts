/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, registerEditorAction, ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { ISingleEditOperation } from 'vs/editor/common/core/editOperation';
import { Selection } from 'vs/editor/common/core/selection';
import { ICommand, ICursorStateComputerData, IEditOperationBuilder } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ITextModel } from 'vs/editor/common/model';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';

export function addPositronCommentMarkers(model: ITextModel, selection: Selection): ISingleEditOperation[] {

	return [
		{
			range: {
				startLineNumber: selection.getStartPosition().lineNumber,
				startColumn: 0,
				endLineNumber: selection.getStartPosition().lineNumber,
				endColumn: 0,
			},
			text: '// --- Begin Positron ---\n',
		},
		{
			range: {
				startLineNumber: selection.getEndPosition().lineNumber,
				startColumn: Infinity,
				endLineNumber: selection.getEndPosition().lineNumber,
				endColumn: Infinity,
			},
			text: '\n// --- End Positron ---\n',
		},
	];

}


export class AddPositronCommentMarkersCommand implements ICommand {

	private readonly _selection: Selection;
	private _selectionId: string | null;

	constructor(selection: Selection) {
		this._selection = selection;
		this._selectionId = null;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		const ops = addPositronCommentMarkers(model, this._selection);
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

	public run(_accessor: ServicesAccessor, editor: ICodeEditor, args: any): void {

		const selection = editor.getSelection();
		if (selection === null) {
			return;
		}

		const command = new AddPositronCommentMarkersCommand(selection);

		editor.pushUndoStop();
		editor.executeCommands(this.id, [command]);
		editor.pushUndoStop();
	}
}

registerEditorAction(AddPositronCommentMarkersAction);
