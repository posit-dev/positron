/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ExtHostContext, ExtHostLanguageRuntimeShape, MainContext, MainThreadLanguageRuntimeShape, MainThreadNotebookKernelsShape } from '../../common/extHost.protocol';
import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { Proxied } from 'vs/workbench/services/extensions/common/proxyIdentifier';

@extHostNamedCustomer(MainContext.MainThreadLanguageRuntime)
export class MainThreadLanguageRuntime implements MainThreadLanguageRuntimeShape {

	private readonly _proxy: Proxied<ExtHostLanguageRuntimeShape>;
	private readonly _disposables = new DisposableStore();

	constructor(
		extHostContext: IExtHostContext,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostLanguageRuntime);
	}

	$registerLangaugeRuntime(runtime: ILanguageRuntime): IDisposable {
		throw new Error('Method not implemented.');
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
