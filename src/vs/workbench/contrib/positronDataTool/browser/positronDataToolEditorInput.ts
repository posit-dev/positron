/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { IUntypedEditorInput } from 'vs/workbench/common/editor';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';

/**
 * PositronDataToolEditorInput class.
 */
export class PositronDataToolEditorInput extends EditorInput {
	/**
	 *
	 */
	static readonly ID: string = 'workbench.input.positronDataTool';

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param resource
	 */
	constructor(readonly resource: URI) {
		super();
	}

	override dispose(): void {
		super.dispose();
	}

	//#endregion Constructor & Dispose

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronDataToolEditorInput &&
			otherInput.resource.toString() === this.resource.toString();
	}

	override get typeId(): string {
		return PositronDataToolEditorInput.ID;
	}

	override getName(): string {
		return localize('positronDataTool', "Positron Data Tool");
	}

	override async resolve(): Promise<null> {
		return null;
	}
}

