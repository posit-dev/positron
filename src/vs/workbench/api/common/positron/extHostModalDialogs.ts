/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as extHostProtocol from './extHost.positron.protocol.js';
import { IThreeButtonModalDialogPromptOptions } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';

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

	public showThreeButtonModalDialogPrompt(options: IThreeButtonModalDialogPromptOptions): Promise<string | undefined> {
		return this._proxy.$showThreeButtonModalDialogPrompt(options);
	}

	public showSimpleModalDialogMessage(title: string, message: string, okButtonTitle?: string): Promise<null> {
		return this._proxy.$showSimpleModalDialogMessage(title, message, okButtonTitle);
	}

	public showSimpleModalDialogInput(title: string, message: string, defaultValue?: string, placeholder?: string, timeout?: number): Promise<string | null> {
		return this._proxy.$showSimpleModalDialogInput(title, message, defaultValue, placeholder, timeout);
	}

}
