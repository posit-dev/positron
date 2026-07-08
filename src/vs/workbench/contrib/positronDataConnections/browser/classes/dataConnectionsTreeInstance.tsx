/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { ReactNode } from 'react';

// Other dependencies.
import { DataConnectionEntryRow } from '../components/dataConnectionEntryRow.js';
import { DataConnectionNodeRow } from '../components/dataConnectionNodeRow.js';
import { TreeNode, VisibleNode } from '../../../../browser/positronTree/classes/treeNode.js';
import { PositronTreeInstance } from '../../../../browser/positronTree/classes/positronTreeInstance.js';
import { IDataConnectionNodeDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { IDataConnectionHandle, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';

/**
 * The row height in pixels. Matches the height used by the previous list-based panel so the
 * panel keeps its current visual rhythm. DTO rows reuse this height.
 */
const ROW_HEIGHT = 24;

/**
 * A data connection entry.
 */
export interface DataConnectionEntry {
	// The data connection profile.
	readonly profile: IDataConnectionProfile;

	// The data connection instance, if connected. Undefined if not connected.
	readonly instance?: IDataConnectionInstance;
}

/**
 * DataConnectionNode discriminated union. Each tree node wraps exactly one of:
 * - an entry (root rows; expanding connects, collapsing disconnects),
 * - a server-side node DTO returned from a connection's getChildren / nodeGetChildren calls.
 *
 * DTO nodes carry the originating IDataConnectionHandle so deeper children can be fetched
 * with handle.nodeGetChildren(dto.nodeHandle) without walking back up the tree.
 */
export type DataConnectionNode =
	| { readonly kind: 'entry'; readonly entry: DataConnectionEntry }
	| { readonly kind: 'dto'; readonly dto: IDataConnectionNodeDTO; readonly handle: IDataConnectionHandle };

const entryNodeId = (profile: IDataConnectionProfile): string => `entry:${profile.id}`;

/**
 * Builds the id for a DTO node. Scoped by the originating connection's numeric handle so DTOs
 * from different connections can't collide.
 */
const dtoNodeId = (handle: IDataConnectionHandle, dto: IDataConnectionNodeDTO): string =>
	`dto:${handle.handle}:${dto.nodeHandle}`;

const wrapEntry = (entry: DataConnectionEntry): TreeNode<DataConnectionNode> => ({
	id: entryNodeId(entry.profile),
	data: { kind: 'entry', entry },
	// Entries always show a twistie -- clicking it connects (or disconnects). Whether children
	// exist is only knowable after the connect succeeds.
	hasChildren: true,
});

/**
 * Wraps a server-side node DTO as a tree node, tagging it with the originating connection handle so
 * deeper children can be fetched without walking back up. Exported so a single-connection tree (e.g.
 * the database editor) can reuse the exact DTO-walking shape.
 */
export const wrapDto = (dto: IDataConnectionNodeDTO, handle: IDataConnectionHandle): TreeNode<DataConnectionNode> => ({
	id: dtoNodeId(handle, dto),
	data: { kind: 'dto', dto, handle },
	hasChildren: dto.hasGetChildren,
});

/**
 * DataConnectionsTreeInstance. Backs the Data Connections panel.
 *
 * Roots are one entry per saved profile, joined with its live instance (if connected). Expanding
 * an entry opens the connection via the service and fetches the connection's top-level DTOs;
 * collapsing an entry closes the connection and drops the loaded subtree so the next expand
 * re-fetches against a fresh handle.
 */
export class DataConnectionsTreeInstance extends PositronTreeInstance<DataConnectionNode> {
	constructor(private readonly _service: IPositronDataConnectionsService) {
		super({
			rowHeight: ROW_HEIGHT,
			indentWidth: 16,
			getRoots: async () => buildEntries(_service).map(wrapEntry),
			// Bound to `this` so the closure can reach _service for the connect-on-expand path.
			getChildren: node => this._fetchChildrenForNode(node),
			renderNode: renderRow,
		});

		// When profiles or instances change, rebuild roots so each entry sees its current
		// connected/disconnected state. setRoots is sync and preserves existing expansion /
		// loaded children by id, so unaffected entries keep their state.
		const refreshRoots = () => {
			this.setRoots(buildEntries(this._service).map(wrapEntry));
		};
		this._register(this._service.onDidChangeProfiles(refreshRoots));
		this._register(this._service.onDidChangeInstances(refreshRoots));
	}

	/**
	 * Tree-semantic collapse. For entry nodes, disconnects the underlying connection and drops
	 * any loaded DTO subtree so the next expand re-fetches against a fresh handle. Disconnect is
	 * fire-and-forget -- the UI shouldn't block on the network round trip to close the channel.
	 */
	override collapse(id: string): void {
		const node = this._findEntryNode(id);
		if (node !== undefined && node.entry.instance !== undefined) {
			// Drop loaded children first so the projection updates before the service-driven
			// rebuild (from onDidChangeInstances) lands.
			this.dropLoadedChildren(id);
			void this._service.disconnect(node.entry.profile.id);
		}
		super.collapse(id);
	}

	/**
	 * Fetches children for a node. For an entry node without a live instance, opens the
	 * connection first, then fetches the top-level DTOs against the new handle. Running this
	 * inside the base class's _fetchChildren means the loading state (twistie spinner) covers
	 * the connect + getChildren as one continuous operation, and a connect failure surfaces
	 * through the tree's existing error state.
	 */
	private async _fetchChildrenForNode(
		node: TreeNode<DataConnectionNode>
	): Promise<readonly TreeNode<DataConnectionNode>[]> {
		const data = node.data;
		switch (data.kind) {
			case 'entry': {
				const instance = data.entry.instance
					?? await this._service.connect(data.entry.profile.id);
				const dtos = await instance.connectionHandle.getChildren();
				return dtos.map(dto => wrapDto(dto, instance.connectionHandle));
			}
			case 'dto': {
				const dtos = await data.handle.nodeGetChildren(data.dto.nodeHandle);
				return dtos.map(dto => wrapDto(dto, data.handle));
			}
		}
	}

	private _findEntryNode(id: string): { entry: DataConnectionEntry } | undefined {
		const visible = this.visibleNodes.find(v => v.node.id === id);
		if (visible === undefined) {
			return undefined;
		}
		const data = visible.node.data;
		return data.kind === 'entry' ? { entry: data.entry } : undefined;
	}
}

/**
 * Builds the entries from the service's current profile + instance collections. One entry per
 * saved profile; the entry's instance is set when a live connection exists for that profile.
 */
function buildEntries(service: IPositronDataConnectionsService): DataConnectionEntry[] {
	return service.getProfiles().map(profile => ({
		profile,
		instance: service.getInstanceForProfile(profile.id),
	}));
}

function renderRow(visible: VisibleNode<DataConnectionNode>): ReactNode {
	const data = visible.node.data;
	switch (data.kind) {
		case 'entry':
			return <DataConnectionEntryRow entry={data.entry} />;
		case 'dto':
			return <DataConnectionNodeRow dto={data.dto} handle={data.handle} />;
	}
}
