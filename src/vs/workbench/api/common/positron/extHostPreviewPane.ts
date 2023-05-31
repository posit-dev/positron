/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPreviewPaneItem } from 'vs/workbench/services/positronPreview/common/positronPreview';
import * as extHostProtocol from './extHost.positron.protocol';
import type * as positron from 'positron';

export class ExtHostPreviewPane implements extHostProtocol.ExtHostPreviewPaneShape {

	private readonly _proxy: extHostProtocol.MainThreadPreviewPaneShape;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext
	) {
		// Trigger creation of the proxy
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadPreviewPane);
	}

	$emitMessageFromPreviewPane(handle: number, message: Object): void {
		throw new Error('Method not implemented.');
	}

	createPreviewPaneItem(options: positron.PreviewPaneItemOptions): IPreviewPaneItem {
		this._proxy.$createPreviewPaneItem(0, options);
		throw new Error('Method not implemented.');
	}
}
