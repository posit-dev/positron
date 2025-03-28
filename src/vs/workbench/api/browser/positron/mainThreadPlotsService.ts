/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ExtHostPlotsServiceShape, ExtHostPositronContext, MainPositronContext, MainThreadPlotsServiceShape } from '../../common/positron/extHost.positron.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IPositronPlotsService, PlotsRenderSettings } from '../../../services/positronPlots/common/positronPlots.js';

@extHostNamedCustomer(MainPositronContext.MainThreadPlotsService)
export class MainThreadPlotsService implements MainThreadPlotsServiceShape {

	private readonly _disposables = new DisposableStore();
	private readonly _proxy: ExtHostPlotsServiceShape;

	constructor(
		extHostContext: IExtHostContext,
		@IPositronPlotsService private readonly _positronPlotsService: IPositronPlotsService
	) {
		// Create the proxy for the extension host.
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostPlotsService);

		// Forward changes to the plot rendering settings to the extension host.
		this._disposables.add(
			this._positronPlotsService.onDidChangePlotsRenderSettings((settings) => {
				this._proxy.$onDidChangePlotsRenderSettings(settings);
			}));
	}

	dispose(): void {
		this._disposables.dispose();
	}

	async $getPlotsRenderSettings(): Promise<PlotsRenderSettings> {
		return this._positronPlotsService.getPlotsRenderSettings();
	}
}
