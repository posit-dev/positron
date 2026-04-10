/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { DataConnectionParameterValues, IDataConnectionDriver, IDataConnectionDriverMetadata, IDataConnectionHandle, IDataConnectionNodeDTO } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';
import { ExtHostDataConnectionsShape, ExtHostPositronContext, MainPositronContext, MainThreadDataConnectionsShape } from '../../common/positron/extHost.positron.protocol.js';

// Registers this class as a named customer so the extension host manager
// automatically instantiates it when the extension host connects, wiring up
// bidirectional RPC between MainThreadDataConnections and ExtHostDataConnections.
@extHostNamedCustomer(MainPositronContext.MainThreadDataConnections)

/**
 * Main thread counterpart to ExtHostDataConnections. Receives driver
 * registrations from the extension host and forwards them to the
 * IPositronDataConnectionsService so the UI can discover and use them.
 */
export class MainThreadDataConnections implements MainThreadDataConnectionsShape {

	// Proxy to call back into the extension host (e.g. $driverConnect, $connectionGetChildren).
	private readonly _proxy: ExtHostDataConnectionsShape;

	// The disposable store.
	private readonly _disposableStore = new DisposableStore();

	/**
	 * Constructor.
	 * @param extHostContext The extension host context, used to obtain the RPC proxy.
	 * @param _dataConnectionsService The data connections service for driver registration.
	 */
	constructor(
		extHostContext: IExtHostContext,
		@IPositronDataConnectionsService private readonly _dataConnectionsService: IPositronDataConnectionsService
	) {
		// Get the ext host proxy so adapters can call back for connect/getChildren/etc.
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostDataConnections);
	}

	/**
	 * Called by the ext host when an extension registers a data connection driver.
	 * Wraps the driver in an adapter and registers it with the service.
	 * @param driverId The unique identifier for the driver.
	 * @param metadata Serializable driver info (name, parameters, supported languages, etc.).
	 */
	$registerDataConnectionDriver(driverId: string, metadata: IDataConnectionDriverMetadata): void {
		this._dataConnectionsService.driverManager.registerDriver(
			new MainThreadDataConnectionDriverAdapter(driverId, metadata, this._proxy)
		);
	}

	/**
	 * Called by the ext host when a driver is unregistered (its Disposable was disposed).
	 * @param driverId The unique identifier for the driver to remove.
	 */
	$removeDataConnectionDriver(driverId: string): void {
		this._dataConnectionsService.driverManager.removeDriver(driverId);
	}

	// Called by the extension host manager when the extension host disconnects.
	dispose(): void {
		this._disposableStore.dispose();
	}
}

/**
 * Adapter that implements the service-level IDataConnectionDriver interface by
 * wrapping calls back through the RPC proxy to the extension host.
 */
class MainThreadDataConnectionDriverAdapter implements IDataConnectionDriver {
	/**
	 * Constructor.
	 * @param id The unique driver identifier.
	 * @param metadata Serializable driver info forwarded from the ext host.
	 * @param _proxy RPC proxy for calling back into the extension host.
	 */
	constructor(
		readonly id: string,
		readonly metadata: IDataConnectionDriverMetadata,
		private readonly _proxy: ExtHostDataConnectionsShape
	) { }

	/**
	 * Calls the extension's driver.connect() via RPC and wraps the returned
	 * connection handle in an adapter the service can operate on.
	 * @param params User-supplied parameter values from the connection dialog.
	 */
	async connect(params: DataConnectionParameterValues): Promise<IDataConnectionHandle> {
		// Ask the ext host to call driver.connect(); returns an integer handle.
		const connectionHandle = await this._proxy.$driverConnect(this.id, params);

		// Wrap the handle so the service can call getChildren/disconnect/etc.
		return new MainThreadDataConnectionHandleAdapter(connectionHandle, this._proxy);
	}
}

/**
 * Adapter that wraps a connection handle, delegating all operations back to
 * the extension host through the RPC proxy.
 */
class MainThreadDataConnectionHandleAdapter implements IDataConnectionHandle {
	/**
	 * Constructor.
	 * @param handle The integer connection handle assigned by the ext host.
	 * @param _proxy RPC proxy for calling back into the extension host.
	 */
	constructor(
		readonly handle: number,
		private readonly _proxy: ExtHostDataConnectionsShape
	) { }

	/**
	 * Fetches top-level children (databases, schemas, etc.) from the ext host.
	 */
	async getChildren(): Promise<IDataConnectionNodeDTO[]> {
		return this._proxy.$connectionGetChildren(this.handle);
	}

	/**
	 * Tells the extension to disconnect but keeps the handle alive.
	 */
	async disconnect(): Promise<void> {
		return this._proxy.$connectionDisconnect(this.handle);
	}

	/**
	 * Checks whether the extension-side connection is still active.
	 */
	async isConnected(): Promise<boolean> {
		return this._proxy.$connectionIsConnected(this.handle);
	}

	/**
	 * Expands a specific node in the tree by its handle.
	 */
	async nodeGetChildren(nodeHandle: number): Promise<IDataConnectionNodeDTO[]> {
		return this._proxy.$nodeGetChildren(this.handle, nodeHandle);
	}

	/**
	 * Triggers a data preview for the given node (e.g. table contents).
	 */
	async nodePreview(nodeHandle: number): Promise<void> {
		return this._proxy.$nodePreview(this.handle, nodeHandle);
	}

	/**
	 * Frees this connection handle and all associated node handles in the ext host.
	 */
	release(): void {
		this._proxy.$releaseConnection(this.handle);
	}
}
