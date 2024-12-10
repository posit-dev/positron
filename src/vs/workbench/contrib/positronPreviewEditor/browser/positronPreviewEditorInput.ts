/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IPositronPreviewService } from '../../positronPreview/browser/positronPreviewSevice.js';

export class PositronPreviewEditorInput extends EditorInput {
	static readonly TypeID: string = 'workbench.input.positronPreview';

	static readonly EditorID: string = 'workbench.editor.positronPreview';

	_name: string;

	_previewId: string;

	constructor(
		readonly resource: URI,
		@IPositronPreviewService private readonly _positronPreviewService: IPositronPreviewService
	) {
		super();
		this._previewId = this.resource.path;
		this._name = this._positronPreviewService.editorTitle(this._previewId) || this._previewId;
	}

	override dispose(): void {
		this._positronPreviewService.disposeEditor(this._previewId);
		super.dispose();
	}

	override get typeId(): string {
		return PositronPreviewEditorInput.TypeID;
	}

	override get editorId(): string {
		return PositronPreviewEditorInput.EditorID;
	}

	override getName(): string {
		return this._name;
	}

	setName(name: string): void {
		this._name = name;
		this._onDidChangeLabel.fire();
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronPreviewEditorInput &&
			otherInput.resource.toString() === this.resource.toString();
	}
}
