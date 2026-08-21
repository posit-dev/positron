/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IPositronDataExplorerService } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IDataExplorerRpcDto, IDataExplorerResponseDto, IDataExplorerRpcTransport, IDataExplorerUiEventDto } from '../../../services/positronDataExplorer/common/dataExplorerRpcTransport.js';
import { ExtHostDataExplorerShape, ExtHostPositronContext, MainPositronContext, MainThreadDataExplorerShape } from '../../common/positron/extHost.positron.protocol.js';

/**
 * Main thread counterpart to ExtHostDataExplorer, one per extension host. Acts as this host's
 * {@link IDataExplorerRpcTransport} for core Data Explorer backends -- forwarding each RPC over the
 * typed ext-host channel to the providing extension -- routes the extension's frontend UI events and
 * open requests into the IPositronDataExplorerService, and tells the service which providers this
 * host owns as their handlers register. The service triggers activation and routes RPCs to the owner.
 */
@extHostNamedCustomer(MainPositronContext.MainThreadDataExplorer)
export class MainThreadDataExplorer implements MainThreadDataExplorerShape, IDataExplorerRpcTransport {

	private readonly _proxy: ExtHostDataExplorerShape;
	private readonly _disposables = new DisposableStore();

	constructor(
		extHostContext: IExtHostContext,
		@IPositronDataExplorerService private readonly _dataExplorerService: IPositronDataExplorerService
	) {
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostDataExplorer);
		// Register this host so its provider claims are cleared if the host disconnects.
		this._disposables.add(this._dataExplorerService.registerRpcHost(this));
	}

	// --- IDataExplorerRpcTransport ---

	handleRpc(providerId: string, rpc: IDataExplorerRpcDto): Promise<IDataExplorerResponseDto> {
		// The service resolves this transport only once the provider has registered here, so the
		// extension is already active; `$handleRpc` also waits for the handler as a safety net.
		return this._proxy.$handleRpc(providerId, rpc);
	}

	disposeBackend(providerId: string, datasetId: string): void {
		this._proxy.$disposeBackend(providerId, datasetId);
	}

	// --- MainThreadDataExplorerShape (called by the ext host) ---

	$registerRpcHandler(providerId: string): void {
		// Tells the service this host is the one that can service the provider's RPCs. In web there
		// are two hosts and only one of them has the extension, so this is what routes correctly.
		this._dataExplorerService.registerRpcProvider(providerId, this);
	}

	$unregisterRpcHandler(providerId: string): void {
		this._dataExplorerService.unregisterRpcProvider(providerId, this);
	}

	$sendUiEvent(event: IDataExplorerUiEventDto): void {
		this._dataExplorerService.routeUiEvent(event);
	}

	$open(providerId: string, datasetId: string, displayName: string): Promise<void> {
		return this._dataExplorerService.openWithExtensionBackend({ providerId, datasetId, displayName });
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
