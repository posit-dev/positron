/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { IUntypedEditorInput } from 'vs/workbench/common/editor';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';

export class PositronDataToolInput extends EditorInput {

	static readonly ID: string = 'workbench.input.positronDataTool';

	// readonly resource: URI = URI.from({
	// 	scheme: Schemas.positronDataTool,
	// 	path: `pos`
	// });

	constructor(readonly resource: URI) {
		super();
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronDataToolInput && otherInput.resource.toString() === this.resource.toString();
	}

	override get typeId(): string {
		return PositronDataToolInput.ID;
	}

	override getName(): string {
		return localize('positronDataTool', "Positron Data Tool");
	}

	override async resolve(): Promise<null> {
		return null;
	}

	override dispose(): void {
		super.dispose();
	}
}

