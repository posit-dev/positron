/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as extHostProtocol from './extHost.positron.protocol.js';
import { IDataConnectionCodeVariantDTO, IDataConnectionDriverMetadataDTO, IDataConnectionDriverSummaryDTO, IDataConnectionNodeDTO, IDataConnectionParameterDTO } from '../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { Disposable } from '../extHostTypes.js';

/**
 * Extension host implementation for the `positron.dataConnections` API namespace.
 *
 * DataConnection and DataConnectionNode objects live in the extension process and
 * expose methods (getChildren, preview, disconnect, etc.). Since these objects
 * cannot cross the RPC boundary directly, we use a handle-based approach:
 *
 * - Each live DataConnection gets an integer connection handle.
 * - Each DataConnectionNode gets an integer node handle, scoped to its connection.
 * - The main thread references these handles when it needs to call back into the
 *   extension (e.g. to expand a tree node or disconnect).
 *
 * Handle lifecycle:
 * - Connection handles are created in $driverConnect and freed by $releaseConnection
 *   or when the driver is unregistered.
 * - Node handles are created each time getChildren returns and are stored per-connection.
 *   They are bulk-cleared when $connectionGetChildren is called (top-level refresh) or
 *   when $releaseConnection frees the entire connection.
 */
export class ExtHostDataConnections implements extHostProtocol.ExtHostDataConnectionsShape {

	private readonly _proxy: extHostProtocol.MainThreadDataConnectionsShape;

	/** Registered drivers keyed by driver id. */
	private readonly _drivers = new Map<string, positron.DataConnectionDriver>();

	/** Monotonically increasing handle counters. */
	private _nextConnectionHandle = 1;
	private _nextNodeHandle = 1;

	/** Connection handle -> live DataConnection object in the extension process. */
	private readonly _connections = new Map<number, positron.DataConnection>();

	/**
	 * Per-connection node handle map: connectionHandle -> (nodeHandle -> DataConnectionNode).
	 * Node handles allow the main thread to reference specific nodes for getChildren/preview
	 * without serializing the node objects themselves.
	 */
	private readonly _nodes = new Map<number, Map<number, positron.DataConnectionNode>>();

	/** Tracks which connection handles belong to which driver for cleanup on dispose. */
	private readonly _driverConnections = new Map<string, Set<number>>();

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadDataConnections);
	}

	// --- Public API (called by extension via positron.dataConnections.registerDriver) ---

	/**
	 * Registers a data connection driver. Sends serializable metadata to the main thread and
	 * returns a Disposable that cleans up the driver and all connections it created.
	 */
	public registerDriver(driver: positron.DataConnectionDriver): Disposable {
		this._drivers.set(driver.id, driver);
		this._driverConnections.set(driver.id, new Set());

		// Convert the driver's public API shape into a serializable DTO. Base64-encode the SVG so
		// the UI can use it directly in <img> src attributes.
		const metadata: IDataConnectionDriverMetadataDTO = {
			id: driver.id,
			name: driver.name,
			description: driver.description,
			iconSvg: btoa(driver.iconSvg),
			mechanisms: driver.mechanisms.map(m => ({
				id: m.id,
				label: m.label,
				description: m.description,
				parameters: m.parameters.map(p => this._convertParameter(p)),
			})),
			supportedLanguageIds: driver.supportedLanguageIds,
		};

		this._proxy.$registerDataConnectionDriver(driver.id, metadata);

		return new Disposable(() => {
			this._drivers.delete(driver.id);

			// Release all connections created by this driver.
			const connectionHandles = this._driverConnections.get(driver.id);
			if (connectionHandles) {
				for (const handle of connectionHandles) {
					this._releaseConnectionHandle(handle);
				}
				this._driverConnections.delete(driver.id);
			}

			this._proxy.$removeDataConnectionDriver(driver.id);
		});
	}

	/**
	 * Returns summaries of all registered drivers by calling the main thread service. This
	 * exercises the full RPC round trip.
	 */
	public async getDrivers(): Promise<positron.DataConnectionDriverSummary[]> {
		const dtos: IDataConnectionDriverSummaryDTO[] = await this._proxy.$getDataConnectionDrivers();
		return dtos.map(dto => ({
			id: dto.id,
			name: dto.name,
			description: dto.description,
			mechanisms: dto.mechanisms.map(m => ({
				id: m.id,
				label: m.label,
				description: m.description,
				parameters: m.parameters as positron.DataConnectionParameter[],
			})),
			supportedLanguageIds: dto.supportedLanguageIds,
		}));
	}

	/**
	 * Connects to a driver by calling through the main thread service, which calls back into the
	 * ext host via $driverConnect (full round trip). Returns a DataConnection proxy that routes
	 * all operations through the main thread.
	 */
	public async connect(driverId: string, mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
		const connectionHandle = await this._proxy.$connectToDataConnectionDriver(driverId, mechanismId, params);
		return new ExtHostDataConnectionProxy(connectionHandle, this._proxy);
	}

	// --- ExtHostDataConnectionsShape (called by main thread via RPC) ---

	/**
	 * Calls the extension's driver.connect(), stores the resulting DataConnection, and returns a
	 * handle the main thread can use to operate on it.
	 * @param driverId The unique identifier of the driver to connect with.
	 * @param mechanismId The id of the mechanism the user selected.
	 * @param params User-supplied parameter values from the connection dialog.
	 */
	async $driverConnect(driverId: string, mechanismId: string, params: Record<string, string | number | boolean>): Promise<number> {
		const driver = this._drivers.get(driverId);
		if (!driver) {
			throw new Error(`Data connection driver '${driverId}' not found`);
		}

		const connection = await driver.connect(mechanismId, params);
		const handle = this._nextConnectionHandle++;
		this._connections.set(handle, connection);
		this._nodes.set(handle, new Map());

		// Track this connection under its driver for cleanup on driver dispose.
		this._driverConnections.get(driverId)?.add(handle);

		return handle;
	}

	/**
	 * Calls the extension's driver.generateConnectionCode() and maps its variants into DTOs for the
	 * main thread.
	 * @param driverId The unique identifier of the driver to generate code with.
	 * @param mechanismId The id of the mechanism the user selected.
	 * @param languageId One of the driver's supported language ids.
	 * @param params User-supplied parameter values from the connection dialog.
	 */
	async $generateConnectionCode(driverId: string, mechanismId: string, languageId: string, params: Record<string, string | number | boolean>): Promise<IDataConnectionCodeVariantDTO[]> {
		const driver = this._drivers.get(driverId);
		if (!driver) {
			throw new Error(`Data connection driver '${driverId}' not found`);
		}
		if (!driver.generateConnectionCode) {
			throw new Error(`Data connection driver '${driverId}' does not support generating connection code`);
		}

		const variants = await driver.generateConnectionCode(mechanismId, languageId, params);
		return variants.map(variant => ({ id: variant.id, label: variant.label, code: variant.code }));
	}

	/**
	 * Calls the extension's driver.redactParameterValue() to produce a display-safe form of a stored
	 * secret value. The cleartext value stays in the ext host; only the redacted result is returned to
	 * the main thread. Returns undefined when the driver does not implement redaction.
	 * @param driverId The unique identifier of the driver.
	 * @param mechanismId The id of the mechanism the connection was configured with.
	 * @param parameterId The id of the parameter to redact.
	 * @param value The stored cleartext parameter value.
	 */
	async $redactParameterValue(driverId: string, mechanismId: string, parameterId: string, value: string): Promise<string | undefined> {
		const driver = this._drivers.get(driverId);
		if (!driver || !driver.redactParameterValue) {
			return undefined;
		}

		return (await driver.redactParameterValue(mechanismId, parameterId, value)) ?? undefined;
	}

	/**
	 * Returns whether the connection was opened in read-only mode.
	 */
	async $connectionIsReadOnly(connectionHandle: number): Promise<boolean> {
		const connection = this._connections.get(connectionHandle);
		if (!connection) {
			throw new Error(`Connection handle ${connectionHandle} not found`);
		}
		return connection.isReadOnly();
	}

	/**
	 * Gets the top-level children of a connection. Clears any previously cached node handles for
	 * this connection since a top-level call implies a full tree refresh.
	 */
	async $connectionGetChildren(connectionHandle: number): Promise<IDataConnectionNodeDTO[]> {
		const connection = this._connections.get(connectionHandle);
		if (!connection) {
			throw new Error(`Connection handle ${connectionHandle} not found`);
		}

		// Clear existing node handles to prevent unbounded growth on refresh.
		this._nodes.set(connectionHandle, new Map());

		const children = await connection.getChildren();
		return this._serializeNodes(connectionHandle, children);
	}

	/** Disconnects but does not release the handle (the UI may still reference it). */
	async $connectionDisconnect(connectionHandle: number): Promise<void> {
		const connection = this._connections.get(connectionHandle);
		if (!connection) {
			throw new Error(`Connection handle ${connectionHandle} not found`);
		}
		await connection.disconnect();
	}

	/** Returns false for unknown handles rather than throwing. */
	async $connectionIsConnected(connectionHandle: number): Promise<boolean> {
		const connection = this._connections.get(connectionHandle);
		if (!connection) {
			return false;
		}
		return connection.isConnected();
	}

	/** Expands a node in the tree by calling its getChildren method. */
	async $nodeGetChildren(connectionHandle: number, nodeHandle: number): Promise<IDataConnectionNodeDTO[]> {
		const nodeMap = this._nodes.get(connectionHandle);
		if (!nodeMap) {
			throw new Error(`Connection handle ${connectionHandle} not found`);
		}
		const node = nodeMap.get(nodeHandle);
		if (!node || !node.getChildren) {
			throw new Error(`Node handle ${nodeHandle} does not support getChildren`);
		}

		const children = await node.getChildren();
		return this._serializeNodes(connectionHandle, children);
	}

	/** Triggers a data preview for a node (e.g. SELECT * FROM table LIMIT 100). */
	async $nodePreview(connectionHandle: number, nodeHandle: number): Promise<void> {
		const nodeMap = this._nodes.get(connectionHandle);
		if (!nodeMap) {
			throw new Error(`Connection handle ${connectionHandle} not found`);
		}
		const node = nodeMap.get(nodeHandle);
		if (!node || !node.preview) {
			throw new Error(`Node handle ${nodeHandle} does not support preview`);
		}
		await node.preview();
	}

	/** Frees a connection handle and all its associated node handles. */
	$releaseConnection(connectionHandle: number): void {
		this._releaseConnectionHandle(connectionHandle);
	}

	// --- Private helpers ---

	/**
	 * Releases a connection handle, its node map, and removes it from driver tracking so it is no
	 * longer cleaned up on driver dispose.
	 */
	private _releaseConnectionHandle(connectionHandle: number): void {
		this._connections.delete(connectionHandle);
		this._nodes.delete(connectionHandle);

		for (const handles of this._driverConnections.values()) {
			handles.delete(connectionHandle);
		}
	}

	/**
	 * Converts an array of extension-side DataConnectionNode objects into serializable DTOs,
	 * assigning each node a handle for future callbacks.
	 */
	private _serializeNodes(connectionHandle: number, nodes: positron.DataConnectionNode[]): IDataConnectionNodeDTO[] {
		const nodeMap = this._nodes.get(connectionHandle)!;
		return nodes.map(node => {
			const handle = this._nextNodeHandle++;
			nodeMap.set(handle, node);
			return {
				nodeHandle: handle,
				name: node.name,
				kind: node.kind,
				dataType: node.dataType,
				isPrimaryKey: node.isPrimaryKey,
				hasGetChildren: !!node.getChildren,
				hasPreview: !!node.preview,
			};
		});
	}

	/**
	 * Converts a typed DataConnectionParameter from the public API into a flat DTO that can be
	 * serialized across the RPC boundary. Uses the `type` discriminant to extract variant-specific
	 * fields.
	 */
	private _convertParameter(p: positron.DataConnectionParameter): IDataConnectionParameterDTO {
		const dto: IDataConnectionParameterDTO = {
			id: p.id,
			label: p.label,
			description: p.description,
			required: p.required,
			type: p.type,
		};
		switch (p.type) {
			case 'string':
				dto.placeholder = p.placeholder;
				if (p.secret) {
					dto.secret = true;
					dto.masked = p.masked;
				} else {
					dto.defaultValue = p.defaultValue;
				}
				break;
			case 'number':
			case 'file':
				dto.defaultValue = p.defaultValue;
				dto.placeholder = p.placeholder;
				break;
			case 'boolean':
				dto.defaultValue = p.defaultValue;
				break;
			case 'option':
				dto.defaultValue = p.defaultValue;
				dto.placeholder = p.placeholder;
				dto.options = p.options;
				break;
			case 'password':
				dto.secret = p.secret;
				dto.placeholder = p.placeholder;
				break;
		}
		return dto;
	}
}

/**
 * A DataConnection proxy that routes all operations through the main thread via the "ViaService"
 * RPC methods. This ensures that calls from the ext host API (e.g. in integration tests)
 * exercise the full main-thread service layer.
 */
class ExtHostDataConnectionProxy implements positron.DataConnection {

	/**
	 * Constructor.
	 * @param _connectionHandle The integer connection handle assigned by the ext host.
	 * @param _proxy RPC proxy for calling through the main thread service.
	 */
	constructor(
		private readonly _connectionHandle: number,
		private readonly _proxy: extHostProtocol.MainThreadDataConnectionsShape,
	) { }

	/**
	 * Returns whether this connection was opened in read-only mode.
	 */
	async isReadOnly(): Promise<boolean> {
		return this._proxy.$connectionIsReadOnlyViaService(this._connectionHandle);
	}

	/**
	 * Returns top-level schema objects (tables, views, etc.) for this connection.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		const dtos = await this._proxy.$connectionGetChildrenViaService(this._connectionHandle);
		return dtos.map(dto => this._dtoToNode(dto));
	}

	/**
	 * Disconnects this connection.
	 */
	async disconnect(): Promise<void> {
		return this._proxy.$connectionDisconnectViaService(this._connectionHandle);
	}

	/**
	 * Returns whether this connection is still connected.
	 */
	async isConnected(): Promise<boolean> {
		return this._proxy.$connectionIsConnectedViaService(this._connectionHandle);
	}

	/**
	 * Converts a serializable node DTO into a DataConnectionNode, wiring up getChildren and
	 * preview callbacks that route through the main thread.
	 * @param dto The serializable node DTO from the RPC layer.
	 * @returns A DataConnectionNode with live callbacks.
	 */
	private _dtoToNode(dto: IDataConnectionNodeDTO): positron.DataConnectionNode {
		const node: positron.DataConnectionNode = {
			name: dto.name,
			kind: dto.kind as positron.DataConnectionNodeKind,
			dataType: dto.dataType,
		};

		if (dto.hasGetChildren) {
			node.getChildren = async () => {
				const childDtos = await this._proxy.$nodeGetChildrenViaService(this._connectionHandle, dto.nodeHandle);
				return childDtos.map(child => this._dtoToNode(child));
			};
		}

		if (dto.hasPreview) {
			node.preview = async () => {
				return this._proxy.$nodePreviewViaService(this._connectionHandle, dto.nodeHandle);
			};
		}

		return node;
	}
}

