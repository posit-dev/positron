/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IPositronDataExplorerService } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IDataExplorerRpcDto, IDataExplorerResponseDto, IDataExplorerRpcTransport, IDataExplorerUiEventDto } from '../../../services/positronDataExplorer/common/dataExplorerRpcTransport.js';
import { ExtHostDataExplorerShape, ExtHostPositronContext, MainPositronContext, MainThreadDataExplorerShape } from '../../common/positron/extHost.positron.protocol.js';

/**
 * Activation event a Data Explorer backend extension declares so it activates lazily when a dataset
 * it owns is first accessed, rather than eagerly at startup. The provider id is the suffix, e.g.
 * `onPositronDataExplorerBackend:positron-duckdb`.
 */
function dataExplorerBackendActivationEvent(providerId: string): string {
	return `onPositronDataExplorerBackend:${providerId}`;
}

/**
 * Main thread counterpart to ExtHostDataExplorer. Acts as the {@link IDataExplorerRpcTransport} for
 * core Data Explorer backends -- forwarding each RPC over the typed ext-host channel to the
 * providing extension -- and routes the extension's frontend UI events and open requests into the
 * IPositronDataExplorerService. Registers itself as the service's transport for its lifetime.
 */
@extHostNamedCustomer(MainPositronContext.MainThreadDataExplorer)
export class MainThreadDataExplorer implements MainThreadDataExplorerShape, IDataExplorerRpcTransport {

	private readonly _proxy: ExtHostDataExplorerShape;
	private readonly _disposables = new DisposableStore();

	constructor(
		extHostContext: IExtHostContext,
		@IPositronDataExplorerService private readonly _dataExplorerService: IPositronDataExplorerService,
		@IExtensionService private readonly _extensionService: IExtensionService
	) {
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostDataExplorer);
		// Become the transport core backends use to reach extensions for the ext host's lifetime.
		this._disposables.add(this._dataExplorerService.registerRpcTransport(this));
	}

	// --- IDataExplorerRpcTransport ---

	async activateProvider(providerId: string): Promise<void> {
		// Backends declare `onPositronDataExplorerBackend:<providerId>` so they stay dormant until a
		// dataset they own is accessed. Idempotent, resolves immediately once activated, and a no-op
		// in hosts the extension isn't installed in.
		await this._extensionService.activateByEvent(dataExplorerBackendActivationEvent(providerId));
	}

	handleRpc(providerId: string, rpc: IDataExplorerRpcDto): Promise<IDataExplorerResponseDto> {
		// The service activates the provider before resolving this transport, so the extension is
		// already active here; `$handleRpc` additionally waits for the provider to register, covering
		// the window between activation returning and the handler landing.
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
