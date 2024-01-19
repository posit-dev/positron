/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IUntypedEditorInput } from 'vs/workbench/common/editor';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { IResolvedNotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookEditorModelResolverService } from 'vs/workbench/contrib/notebook/common/notebookEditorModelResolverService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';

/**
 * PositronDataToolEditorInput class.
 */
export class PositronNotebookEditorInput extends EditorInput {
	//#region Static Properties
	/**
	 * Gets the type ID.
	 */
	static readonly TypeID: string = 'workbench.input.positronNotebook';

	/**
	 * Gets the editor ID.
	 */
	static readonly EditorID: string = 'workbench.editor.positronNotebook';

	//#endregion Static Properties
	//#region Constructor & Dispose
	/**
	 * Constructor.
	 * @param resource The resource.
	 */
	constructor(
		readonly resource: URI,
		public readonly viewType: string,
		// Borrow notebook resolver service from vscode notebook renderer.
		@INotebookEditorModelResolverService private readonly _notebookModelResolverService: INotebookEditorModelResolverService,
		@INotebookService private readonly _notebookService: INotebookService,
	) {
		// Call the base class's constructor.
		super();

		console.log('Resolver Service', this._notebookModelResolverService);

	}

	/**
	 * dispose override method.
	 */
	override dispose(): void {
		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose
	//#region AbstractEditorInput Overrides
	/**
	 * Gets the type identifier.
	 */
	override get typeId(): string {
		return PositronNotebookEditorInput.TypeID;
	}

	/**
	 * Gets the editor identifier.
	 */
	override get editorId(): string {
		return PositronNotebookEditorInput.EditorID;
	}

	/**
	 * Gets the display name of this input.
	 * @returns The display name of this input.
	 */
	override getName(): string {
		return localize('positronNotebookInputName', "Positron Notebook");
	}

	/**
	 * Determines whether the other input matches this input
	 * @param otherInput The other input.
	 * @returns true if the other input matches this input; otherwise, false.
	 */
	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronNotebookEditorInput &&
			otherInput.resource.toString() === this.resource.toString();
	}

	override async resolve(_options?: IEditorOptions): Promise<IResolvedNotebookEditorModel | null> {

		console.log('Running resolver');
		if (!await this._notebookService.canResolve(this.viewType)) {
			return null;
		}

		return null;
		// 		// only now `setInput` and yield/await. this is AFTER the actual widget is ready. This is very important
		// // so that others synchronously receive a notebook editor with the correct widget being set
		// await super.setInput(input, options, context, token);
		// const model = await input.resolve(options, perf);
	}

}
