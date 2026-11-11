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

/** Whether a contract kind names a container, a level that holds objects rather than data. */
function isContainerKind(contractKind: string): boolean {
	switch (toDataConnectionNodeKind(contractKind)) {
		case DataConnectionNodeKind.Table:
		case DataConnectionNodeKind.View:
		case DataConnectionNodeKind.Field:
			return false;
		default:
			return true;
	}
}

/**
 * Wraps one live runtime connection comm (the RStudio connections contract over a
 * `positron.connection` comm) as a data connection handle, so the Data Connections pane can
 * browse it. The comm belongs to the runtime session, not to this handle.
 */
export class RuntimeConnectionHandle extends Disposable implements IDataConnectionHandle {
	/** The contract path of every node handed out, keyed by node handle. */
	private readonly _nodePaths = new Map<number, ObjectSchema[]>();

	/**
	 * Node handles that a `retainNodes` walk holds: the walk's top level and everything fetched
	 * beneath it. A plain top-level fetch (the pane refreshing) frees every other handle but keeps
	 * these, so a walk that is between two levels when the pane refreshes can still use them.
	 * Freed by releaseNodes().
	 */
	private readonly _retained = new Set<number>();

	private _nextNodeHandle = 1;

	private _closed = false;

	private readonly _onDidClose = this._register(new Emitter<void>());

	/** Fires once, when the comm closes from either side. */
	readonly onDidClose: Event<void> = this._onDidClose.event;

	/**
	 * @param handle The handle number, from nextRuntimeConnectionHandle().
	 * @param _client The connection comm client. Not disposed by this class except in disconnect().
	 * @param _onDidDisconnect Called when disconnect() closes the comm.
	 * @param _connectionName The connection's name, as its row shows it.
	 */
	constructor(
		readonly handle: number,
		private readonly _client: ConnectionsClientInstance,
		private readonly _onDidDisconnect: () => void,
		private readonly _connectionName: string,
	) {
		super();
		this._register(this._client.onDidClose(() => this.markClosed()));
	}

	/**
	 * Always false. The session's connection object is not limited to reads, so code run against
	 * it can write.
	 */
	async isReadOnly(): Promise<boolean> {
		return false;
	}

	/**
	 * Fetches the connection's top-level objects. Unless `retainNodes` is set, this frees every
	 * node handle handed out before it.
	 *
	 * A lone top-level container with the connection's own name is skipped, and its children are
	 * returned in its place. The `connections` package reports one such stand-in catalog for every
	 * connection, so without this the tree repeats the row's name one level down. Requests below
	 * it still include it in their path.
	 */
	async getChildren(options?: { retainNodes?: boolean }): Promise<IDataConnectionNodeDTO[]> {
		if (!options?.retainNodes) {
			for (const nodeHandle of this._nodePaths.keys()) {
				if (!this._retained.has(nodeHandle)) {
					this._nodePaths.delete(nodeHandle);
				}
			}
		}
		const topLevel = await this._client.listObjects([]);
		const lone = topLevel.length === 1 ? topLevel[0] : undefined;
		const nodes = lone && lone.name === this._connectionName && isContainerKind(lone.kind)
			? await this._childrenOf([{ name: lone.name, kind: lone.kind }])
			: await this._toNodes([], topLevel, false);
		if (options?.retainNodes) {
			this._retain(nodes);
		}
		return nodes;
	}

	/** Frees node handles collected by a `retainNodes` walk. */
	releaseNodes(nodeHandles: readonly number[]): void {
		for (const nodeHandle of nodeHandles) {
			this._nodePaths.delete(nodeHandle);
			this._retained.delete(nodeHandle);
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
		const nodes = await this._childrenOf(this._getNodePath(nodeHandle));
		if (this._retained.has(nodeHandle)) {
			this._retain(nodes);
		}
		return nodes;
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
		this._retained.clear();
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

	/** Lists the fields of a path that contains data, and its child objects otherwise. */
	private async _childrenOf(path: ObjectSchema[]): Promise<IDataConnectionNodeDTO[]> {
		if (await this._client.containsData(path)) {
			const fields = await this._client.listFields(path);
			return this._toNodes(path, fields.map(field => ({ name: field.name, kind: 'field', dtype: field.dtype })), true);
		}
		return this._toNodes(path, await this._client.listObjects(path), false);
	}

	/** Marks node handles as held by a `retainNodes` walk; see {@link _retained}. */
	private _retain(nodes: readonly IDataConnectionNodeDTO[]): void {
		for (const node of nodes) {
			this._retained.add(node.nodeHandle);
		}
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
		items: { name: string; kind: string; dtype?: string; has_children?: boolean }[],
		isField: boolean,
	): Promise<IDataConnectionNodeDTO[]> {
		return Promise.all(items.map(async item => {
			const path = [...parentPath, { name: item.name, kind: item.kind }];
			// A field never contains data, so skip asking the runtime about it.
			const containsData = !isField && await this._client.containsData(path);
			const nodeHandle = this._nextNodeHandle++;
			this._nodePaths.set(nodeHandle, path);
			const node: IDataConnectionNodeDTO = {
				nodeHandle,
				name: item.name,
				kind: isField ? DataConnectionNodeKind.Field : toDataConnectionNodeKind(item.kind),
				// The contract's has_children is optional; when it is absent, anything but a field
				// may have children.
				hasGetChildren: !isField && (item.has_children ?? item.kind.toLowerCase() !== 'field'),
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
