/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ConnectionsClientInstance } from '../../languageRuntime/common/languageRuntimeConnectionsClient.js';
import { ObjectSchema } from '../../languageRuntime/common/positronConnectionsComm.js';
import { DataConnectionNodeKind, IDataConnectionHandle, IDataConnectionLineageRequest, IDataConnectionLineageResult } from '../../positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionNodeDetailsDTO, IDataConnectionNodeDTO } from '../../positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { toDataConnectionNodeKind } from '../common/runtimeDataConnections.js';

/**
 * Wraps one live runtime connection comm (the RStudio connections contract over a
 * `positron.connection` comm) as a data connection handle, so the Data Connections pane can
 * browse it. The comm belongs to the runtime session, not to this handle.
 */
export class RuntimeConnectionHandle extends Disposable implements IDataConnectionHandle {
	/** The contract path of every node handed out, keyed by node handle. */
	private readonly _nodePaths = new Map<number, ObjectSchema[]>();

	private _nextNodeHandle = 1;

	private _closed = false;

	private readonly _onDidClose = this._register(new Emitter<void>());

	/** Fires once, when the comm closes from either side. */
	readonly onDidClose: Event<void> = this._onDidClose.event;

	/**
	 * @param handle The handle number, from nextRuntimeConnectionHandle().
	 * @param _client The connection comm client. Not disposed by this class except in disconnect().
	 * @param _onDidDisconnect Called when disconnect() closes the comm.
	 */
	constructor(
		readonly handle: number,
		private readonly _client: ConnectionsClientInstance,
		private readonly _onDidDisconnect: () => void,
	) {
		super();
		this._register(this._client.onDidClose(() => this.markClosed()));
	}

	/** Runtime connections cannot be edited through the pane, so this is always false. */
	async isReadOnly(): Promise<boolean> {
		return false;
	}

	/**
	 * Fetches the connection's top-level objects. Unless `retainNodes` is set, this frees every
	 * node handle handed out before it.
	 */
	async getChildren(options?: { retainNodes?: boolean }): Promise<IDataConnectionNodeDTO[]> {
		if (!options?.retainNodes) {
			this._nodePaths.clear();
		}
		return this._toNodes([], await this._client.listObjects([]), false);
	}

	/** Frees node handles collected by a `retainNodes` walk. */
	releaseNodes(nodeHandles: readonly number[]): void {
		for (const nodeHandle of nodeHandles) {
			this._nodePaths.delete(nodeHandle);
		}
	}

	/**
	 * Closes the connection. Closing the comm runs the backend's `disconnect()` in both R and
	 * Python, so this ends the user's connection object. It is a no-op when the comm is already
	 * closed.
	 */
	async disconnect(): Promise<void> {
		if (this._closed) {
			return;
		}
		this._closed = true;
		this._client.dispose();
		// Fire first: _onDidDisconnect lets the owner dispose this handle and its emitter.
		this._onDidClose.fire();
		this._onDidDisconnect();
	}

	/** Resolves true until the comm closes. */
	async isConnected(): Promise<boolean> {
		return !this._closed;
	}

	/** Lists a node's fields when it contains data, and its child objects otherwise. */
	async nodeGetChildren(nodeHandle: number): Promise<IDataConnectionNodeDTO[]> {
		const path = this._getNodePath(nodeHandle);
		if (await this._client.containsData(path)) {
			const fields = await this._client.listFields(path);
			return this._toNodes(path, fields.map(field => ({ name: field.name, kind: 'field', dtype: field.dtype })), true);
		}
		return this._toNodes(path, await this._client.listObjects(path), false);
	}

	/**
	 * Asks the runtime to preview a node. The runtime opens its own Data Explorer, so there is no
	 * dataset id to report.
	 */
	async nodePreview(nodeHandle: number): Promise<string | undefined> {
		await this._client.previewObject(this._getNodePath(nodeHandle));
		return undefined;
	}

	/** The connections contract has no details, so this always rejects. */
	async nodeGetDetails(_nodeHandle: number): Promise<IDataConnectionNodeDetailsDTO> {
		throw new Error(localize('positron.runtimeConnection.noDetails', "Runtime connections do not provide node details."));
	}

	/** The connections contract has no lineage, so this resolves undefined. */
	async getLineage(_request: IDataConnectionLineageRequest): Promise<IDataConnectionLineageResult | undefined> {
		return undefined;
	}

	/**
	 * Clears the node table. This does not close the comm: the handle is shared, and callers
	 * release it after disconnecting when they mean to close the connection.
	 */
	release(): void {
		this._nodePaths.clear();
	}

	/**
	 * Marks the handle closed and fires onDidClose, once. The comm's owner calls this before it
	 * drops the handle (the comm closed, or its session ended), so the handle never reports
	 * connected after the owner stops tracking it. It does not touch the comm.
	 */
	markClosed(): void {
		if (this._closed) {
			return;
		}
		this._closed = true;
		this._onDidClose.fire();
	}

	private _getNodePath(nodeHandle: number): ObjectSchema[] {
		const path = this._nodePaths.get(nodeHandle);
		if (!path) {
			throw new Error(localize('positron.runtimeConnection.unknownNode', "Unknown node handle {0}.", nodeHandle));
		}
		return path;
	}

	private async _toNodes(
		parentPath: ObjectSchema[],
		items: { name: string; kind: string; dtype?: string }[],
		isField: boolean,
	): Promise<IDataConnectionNodeDTO[]> {
		return Promise.all(items.map(async item => {
			const path = [...parentPath, { name: item.name, kind: item.kind }];
			const containsData = await this._client.containsData(path);
			const nodeHandle = this._nextNodeHandle++;
			this._nodePaths.set(nodeHandle, path);
			const node: IDataConnectionNodeDTO = {
				nodeHandle,
				name: item.name,
				kind: isField ? DataConnectionNodeKind.Field : toDataConnectionNodeKind(item.kind),
				hasGetChildren: !isField && item.kind.toLowerCase() !== 'field',
				hasPreview: containsData,
				hasDetails: false,
			};
			if (isField) {
				node.dataType = item.dtype;
			}
			if (containsData) {
				node.defaultAction = 'preview';
			}
			return node;
		}));
	}
}
