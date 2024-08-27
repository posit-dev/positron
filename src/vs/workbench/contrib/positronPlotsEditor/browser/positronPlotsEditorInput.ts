/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { IUntypedEditorInput } from 'vs/workbench/common/editor';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';

export class PositronPlotsEditorInput extends EditorInput {
	static readonly TypeID: string = 'workbench.input.positronPlots';

	static readonly EditorID: string = 'workbench.editor.positronPlots';

	_name: string = 'Plots';

	constructor(
		readonly resource: URI,
		@IPositronPlotsService private readonly _positronPlotsService: IPositronPlotsService
	) { super(); }

	override dispose(): void {
		const editorId = this.resource.toString().replace(`${Schemas.positronPlotsEditor}:`, '').trim();
		const plotClient = this._positronPlotsService.getEditorInstance(editorId);

		if (plotClient) {
			this._positronPlotsService.removePlot(plotClient.id);
		}

		super.dispose();
	}

	override get typeId(): string {
		return PositronPlotsEditorInput.TypeID;
	}

	override get editorId(): string {
		return PositronPlotsEditorInput.EditorID;
	}

	override getName(): string {
		return this._name;
	}

	setName(name: string): void {
		this._name = name;
		this._onDidChangeLabel.fire();
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronPlotsEditorInput &&
			otherInput.resource.toString() === this.resource.toString();
	}
}
