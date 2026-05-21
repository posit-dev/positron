/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { ILifecycleService, ShutdownReason as WorkbenchShutdownReason } from '../../../services/lifecycle/common/lifecycle.js';
import { ExtHostLifecycleShape, ExtHostPositronContext, MainPositronContext, MainThreadLifecycleShape, ShutdownReason } from '../../common/positron/extHost.positron.protocol.js';

@extHostNamedCustomer(MainPositronContext.MainThreadLifecycle)
export class MainThreadLifecycle extends Disposable implements MainThreadLifecycleShape {

	private readonly _proxy: ExtHostLifecycleShape;

	constructor(
		extHostContext: IExtHostContext,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostLifecycle);

		this._register(this._lifecycleService.onWillShutdown(event => {
			// Forward the shutdown reason to the extension host before the
			// window tears down. Joining the shutdown gives the RPC a chance to
			// land so subscribers (e.g. positron-supervisor) can read the
			// reason in their deactivate() handler.
			event.join(this._proxy.$onWillShutdown(toApiShutdownReason(event.reason)), {
				id: 'join.positronOnWillShutdown',
				label: nls.localize('positron.onWillShutdown', "Notifying Positron extensions of shutdown"),
			});
		}));
	}
}

function toApiShutdownReason(reason: WorkbenchShutdownReason): ShutdownReason {
	switch (reason) {
		case WorkbenchShutdownReason.CLOSE: return ShutdownReason.Close;
		case WorkbenchShutdownReason.QUIT: return ShutdownReason.Quit;
		case WorkbenchShutdownReason.RELOAD: return ShutdownReason.Reload;
		case WorkbenchShutdownReason.LOAD: return ShutdownReason.Load;
	}
}
