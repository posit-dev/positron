/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from 'vs/base/common/lifecycle';
import { ExtHostConsoleServiceShape, ExtHostPositronContext, MainPositronContext, MainThreadConsoleServiceShape } from '../../common/positron/extHost.positron.protocol';
import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';

@extHostNamedCustomer(MainPositronContext.MainThreadConsoleService)
export class MainThreadConsoleService implements MainThreadConsoleServiceShape {

	private readonly _disposables = new DisposableStore();

	private readonly _proxy: ExtHostConsoleServiceShape;

	constructor(
		extHostContext: IExtHostContext,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService,
	) {
		// Create the proxy for the extension host.
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostConsoleService);

		// Register to be notified of changes to the console width; when they are
		// received, forward them to the extension host so extensions can be
		// notified.
		this._disposables.add(
			this._positronConsoleService.onDidChangeConsoleWidth((newWidth) => {
				this._proxy.$onDidChangeConsoleWidth(newWidth);
			}));
	}

	$getConsoleWidth(): Promise<number> {
		return Promise.resolve(this._positronConsoleService.getConsoleWidth());
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
