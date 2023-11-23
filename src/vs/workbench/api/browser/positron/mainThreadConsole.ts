/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from 'vs/base/common/lifecycle';
import { ExtHostConsoleShape, ExtHostPositronContext, MainPositronContext, MainThreadConsoleShape } from '../../common/positron/extHost.positron.protocol';
import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';

@extHostNamedCustomer(MainPositronContext.MainThreadConsole)
export class MainThreadConsole implements MainThreadConsoleShape {

	private readonly _disposables = new DisposableStore();

	private readonly _proxy: ExtHostConsoleShape;

	constructor(
		extHostContext: IExtHostContext,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService,
	) {
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostConsole);

		this._disposables.add(
			this._positronConsoleService.onDidChangeConsoleWidth((newWidth) => {
				this._proxy.$onDidChangeConsoleWidth(newWidth);
			}));
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
