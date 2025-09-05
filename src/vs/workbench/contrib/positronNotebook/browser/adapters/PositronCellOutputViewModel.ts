/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { ICellOutputViewModel, ICellViewModel } from '../../../notebook/browser/notebookBrowser.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { ICellOutput, IOrderedMimeType } from '../../../notebook/common/notebookCommon.js';

export class PositronCellOutputViewModel extends Disposable implements ICellOutputViewModel {
	private readonly _onDidResetRenderer = this._register(new Emitter<void>());
	public readonly onDidResetRenderer = this._onDidResetRenderer.event;

	visible = observableValue<boolean>('outputVisible', false);

	constructor(
		public readonly cellViewModel: ICellViewModel,
		public readonly model: ICellOutput
	) {
		super();
	}

	resolveMimeTypes(textModel: NotebookTextModel, kernelProvides: readonly string[] | undefined): [readonly IOrderedMimeType[], number] {
		throw new Error('Method not implemented.');
	}
	pickedMimeType: IOrderedMimeType | undefined;
	hasMultiMimeType(): boolean {
		throw new Error('Method not implemented.');
	}
	setVisible(visible: boolean, force?: boolean): void {
		throw new Error('Method not implemented.');
	}
	resetRenderer(): void {
		throw new Error('Method not implemented.');
	}
	toRawJSON() {
		throw new Error('Method not implemented.');
	}
}
