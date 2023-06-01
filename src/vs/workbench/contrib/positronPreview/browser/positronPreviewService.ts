/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPreviewService, IPreviewPaneItem, IPreviewPaneItemOptions } from 'vs/workbench/services/positronPreview/common/positronPreview';
import { Event, Emitter } from 'vs/base/common/event';

export class PositronPreviewService extends Disposable implements IPositronPreviewService {

	private _onDidCreatePreviewPaneItemEmitter = new Emitter<IPreviewPaneItem>();

	constructor() {
		super();
		this.onDidCreatePreviewPaneItem = this._onDidCreatePreviewPaneItemEmitter.event;
	}

	onDidCreatePreviewPaneItem: Event<IPreviewPaneItem>;

	get previewPaneItems(): IPreviewPaneItem[] {
		throw new Error('Method not implemented.');
	}

	get activePreviewPaneItemId(): string {
		throw new Error('Method not implemented.');
	}

	createPreviewPaneItem(options: IPreviewPaneItemOptions): Thenable<IPreviewPaneItem> {
		throw new Error('Method not implemented.');
	}

	declare readonly _serviceBrand: undefined;
}
