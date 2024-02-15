/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { IUntypedEditorInput } from 'vs/workbench/common/editor';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';

/**
 * PositronDataExplorerEditorInput class.
 */
export class PositronDataExplorerEditorInput extends EditorInput {
	//#region Static Properties

	/**
	 * Gets the type ID.
	 */
	static readonly TypeID: string = 'workbench.input.positronDataExplorer';

	/**
	 * Gets the editor ID.
	 */
	static readonly EditorID: string = 'workbench.editor.positronDataExplorer';

	//#endregion Static Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param resource The resource.
	 */
	constructor(readonly resource: URI) {
		// Call the base class's constructor.
		super();
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
		return PositronDataExplorerEditorInput.TypeID;
	}

	/**
	 * Gets the editor identifier.
	 */
	override get editorId(): string {
		return PositronDataExplorerEditorInput.EditorID;
	}

	/**
	 * Gets the display name of this input.
	 * @returns The display name of this input.
	 */
	override getName(): string {
		return localize('positronDataExplorerInputName', "Positron Data Explorer");
	}

	/**
	 * Determines whether the other input matches this input
	 * @param otherInput The other input.
	 * @returns true if the other input matches this input; otherwise, false.
	 */
	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronDataExplorerEditorInput &&
			otherInput.resource.toString() === this.resource.toString();
	}

	//#endregion AbstractEditorInput Overrides
}
