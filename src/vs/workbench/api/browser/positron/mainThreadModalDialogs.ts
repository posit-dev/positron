/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { MainThreadModalDialogsShape, MainPositronContext } from '../../common/positron/extHost.positron.protocol';
import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';

@extHostNamedCustomer(MainPositronContext.MainThreadModalDialogs)
export class MainThreadModalDialogs implements MainThreadModalDialogsShape {

	private readonly _disposables = new DisposableStore();

	constructor(
		extHostContext: IExtHostContext,
		@IPositronModalDialogsService private readonly _positronModalDialogsService: IPositronModalDialogsService
	) { }

	$showSimpleModalDialogPrompt(title: string, message: string, okButtonTitle?: string, cancelButtonTitle?: string): Promise<boolean> {
		return this._positronModalDialogsService.showSimpleModalDialogPrompt(title, message, okButtonTitle, cancelButtonTitle);
	}

	public dispose(): void {
		this._disposables.dispose();
	}
}
