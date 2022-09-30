/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { MainContext, MainThreadLanguageRuntimeShape } from '../../common/extHost.protocol';
import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
import { DisposableStore } from 'vs/base/common/lifecycle';

@extHostNamedCustomer(MainContext.MainThreadLanguageRuntime)
export class MainThreadLanguageRuntime implements MainThreadLanguageRuntimeShape {

	private readonly _disposables = new DisposableStore();

	constructor(
		extHostContext: IExtHostContext,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService
	) {
	}

	$registerLanguageRuntimeAdapter(runtime: ILanguageRuntime): Promise<void> {
		this._disposables.add(
			this._languageRuntimeService.registerRuntime(runtime));
		return Promise.resolve();
	}

	public dispose(): void {
		this._disposables.dispose();
	}
}
