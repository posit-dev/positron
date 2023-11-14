/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as extHostProtocol from './extHost.positron.protocol';

export class ExtHostModalDialogs implements extHostProtocol.ExtHostModalDialogsShape {

	private readonly _proxy: extHostProtocol.MainThreadModalDialogsShape;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext
	) {
		// Trigger creation of the proxy
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadModalDialogs);
	}

	public showSimpleModalDialogPrompt(title: string, message: string, okButtonTitle?: string, cancelButtonTitle?: string): Promise<boolean> {
		return this._proxy.$showSimpleModalDialogPrompt(title, message, okButtonTitle, cancelButtonTitle);
	}

}
