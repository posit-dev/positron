/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { ReactNode } from 'react';

// Other dependencies.
import { DataConnectionEntryRow } from '../components/dataConnectionEntryRow.js';
import { DataConnectionNodeRow } from '../components/dataConnectionNodeRow.js';
import { TreeNode, TreeNodeContext, VisibleNode } from '../../../../browser/positronTree/classes/treeNode.js';
import { MouseSelectionType } from '../../../../browser/positronDataGrid/classes/dataGridInstance.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { POSITRON_DATA_CONNECTIONS_TREE_INDENT_KEY } from '../positronDataConnectionsConfiguration.js';
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
 * - an entry (root rows; expanding connects, collapsing may disconnect -- see collapse below),
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

/**
 * The identity a node keeps across a refresh, used by the tree to re-expand a subtree after
 * reload. Node handles are minted from a counter on every fetch, so a node's id always changes
 * even when the node itself hasn't -- its kind and name are what actually stay the same. The pair
 * is JSON-encoded so a name that happens to contain the separator can't collide with a different
 * kind/name pair.
 *
 * DTO keys deliberately don't include the originating connection handle: the tree matches a node
 * to its counterpart among its own siblings, which always come from the same connection, so a
 * kind/name pair only ever has to be unique within one level.
 *
 * Exported for tests.
 */
export const reloadKey = (node: DataConnectionNode): string =>
	node.kind === 'entry'
		? entryNodeId(node.entry.profile)
		: JSON.stringify([node.dto.kind, node.dto.name]);

const wrapEntry = (entry: DataConnectionEntry): TreeNode<DataConnectionNode> => ({
	id: entryNodeId(entry.profile),
	data: { kind: 'entry', entry },
	// Entries always show a twisty -- clicking it connects (or collapses, which may disconnect).
	// Whether children exist is only knowable after the connect succeeds.
	hasChildren: true,
});

/**
 * The workbench-wide per-level tree indent setting, in pixels, which this view's own indent falls
 * back to. listService.ts registers the key and reads it for VS Code's own trees but keeps the
 * constant private, so it is repeated here rather than making an upstream file export it.
 */
const TREE_INDENT_KEY = 'workbench.tree.indent';

/**
 * Resolves the tree's per-level indent width: this view's own setting when set, and the
 * workbench-wide tree indent when it is left at the inheriting default of 0. Both keys register
 * numeric defaults, so both reads are trusted to be numbers -- the same trust explorerViewer.ts
 * places in the workbench key.
 *
 * The view has a knob of its own because it nests far deeper than the trees workbench.tree.indent
 * was tuned for -- see POSITRON_DATA_CONNECTIONS_TREE_INDENT_KEY -- but it inherits by default so
 * that a user who turns the workbench setting down doesn't have to discover a second one.
 *
 * @param configurationService The configuration service.
 * @returns The indent width in pixels.
 */
const resolveIndentWidth = (configurationService: IConfigurationService): number => {
	// Zero is this view's "inherit the workbench setting" sentinel rather than a width.
	const viewIndentWidth = configurationService.getValue<number>(POSITRON_DATA_CONNECTIONS_TREE_INDENT_KEY);
	return viewIndentWidth > 0
		? viewIndentWidth
		: configurationService.getValue<number>(TREE_INDENT_KEY);
};

const wrapDto = (dto: IDataConnectionNodeDTO, handle: IDataConnectionHandle): TreeNode<DataConnectionNode> => ({
	id: dtoNodeId(handle, dto),
	data: { kind: 'dto', dto, handle },
	hasChildren: dto.hasGetChildren,
});

/**
 * DataConnectionsTreeInstance. Backs the Data Connections panel.
 *
 * Roots are one entry per saved profile, joined with its live instance (if connected). Expanding
 * an entry opens the connection via the service and fetches the connection's top-level DTOs;
 * collapsing an entry closes the connection -- immediately, or once the last Data Explorer previewed
 * from it closes -- and drops the loaded subtree so the next expand re-fetches against a fresh
 * handle.
 */
export class DataConnectionsTreeInstance extends PositronTreeInstance<DataConnectionNode> {
	constructor(
		private readonly _service: IPositronDataConnectionsService,
		private readonly _configurationService: IConfigurationService,
	) {
		super({
			rowHeight: ROW_HEIGHT,
			indentWidth: resolveIndentWidth(_configurationService),
			getRoots: async () => buildEntries(_service).map(wrapEntry),
			// Bound to `this` so the closure can reach _service for the connect-on-expand path.
			getChildren: node => this._fetchChildrenForNode(node),
			getReloadKey: node => reloadKey(node.data),
			renderNode: (visible, context) => this._renderRow(visible, context),
		});

		// When profiles or instances change, rebuild roots so each entry sees its current
		// connected/disconnected state. setRoots is sync and preserves existing expansion /
		// loaded children by id, so unaffected entries keep their state.
		const refreshRoots = () => {
			const entries = buildEntries(this._service);
			this.setRoots(entries.map(wrapEntry));

			// A loaded DTO subtree is only valid while its connection is open, so drop the subtree of
			// any entry that no longer has a live instance.
			this._dropClosedEntrySubtrees(entries);
		};
		this._register(this._service.onDidChangeProfiles(refreshRoots));
		this._register(this._service.onDidChangeInstances(refreshRoots));
		this._register(this._service.onDidChangeDiscoveredProfiles(refreshRoots));

		// Track both indent settings live -- the workbench one matters even while this view's own is
		// set, since clearing the latter back to 0 has to fall through to it. Indent takes effect
		// without a reload everywhere else in the workbench, and a user dialing it in wants the tree
		// to answer as they drag.
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_DATA_CONNECTIONS_TREE_INDENT_KEY) ||
				e.affectsConfiguration(TREE_INDENT_KEY)) {
				this.setIndentWidth(resolveIndentWidth(this._configurationService));
			}
		}));
	}

	/**
	 * Tree-semantic expand. Expanding a connected entry means the user wants the connection again, so
	 * it cancels any pending close a previous collapse left behind.
	 */
	override async expand(id: string): Promise<void> {
		const node = this._findEntryNode(id);
		if (node !== undefined) {
			this._service.cancelDisconnectWhenUnused(node.entry.profile.id);
		}
		await super.expand(id);
	}

	/**
	 * Tree-semantic collapse. Collapsing an entry gives up the tree's use of its connection, which
	 * closes the connection unless Data Explorers previewed from it are still open. In that case the
	 * connection stays up and closes when the last of them does: collapsing an entry is how a user
	 * reclaims the panel's vertical space, and previews opened from it should keep working. The entry
	 * row's connected indicator shows the connection is still live in the meantime, and its loaded
	 * subtree is kept too, so re-expanding is immediate rather than a fresh round trip.
	 *
	 * The subtree is dropped when the connection actually closes, wherever that happens -- see the
	 * roots refresh in the constructor.
	 */
	override collapse(id: string): void {
		const node = this._findEntryNode(id);
		if (node !== undefined && node.entry.instance !== undefined) {
			this._service.disconnectWhenUnused(node.entry.profile.id);
		}
		super.collapse(id);
	}

	/**
	 * Disconnects an entry's connection outright, at the user's explicit request, and collapses the
	 * entry: with the connection gone there is nothing under it to browse, so leaving it expanded
	 * would show an empty or re-connecting subtree. The Data Explorers previewed from it close too,
	 * because their backends die with the connection.
	 *
	 * Collapsing goes straight to the base implementation rather than through this class's collapse:
	 * that override means the conditional, wait-for-the-previews close a user-driven collapse asks
	 * for, which is the opposite of what is wanted here. The loaded subtree is dropped by the roots
	 * refresh in the constructor once the connection is actually gone.
	 * @param id The node id of the entry to disconnect.
	 */
	async disconnectEntry(id: string): Promise<void> {
		const node = this._findEntryNode(id);
		if (node === undefined) {
			return;
		}
		super.collapse(id);
		await this._service.disconnect(node.entry.profile.id);
	}

	/**
	 * Collapses and unloads every entry that no longer has a live connection. A loaded DTO subtree is
	 * only valid while its connection is open -- its node handles live in the ext host and die with
	 * the connection -- so the subtree is dropped and the next expand re-fetches against a fresh
	 * handle.
	 *
	 * Collapsing matters as much as dropping: an entry left expanded with no children renders as a
	 * twisty that spins forever, because the projection reads "expanded but not loaded" as a fetch in
	 * flight and nothing is fetching. It goes through the base implementation rather than this class's
	 * collapse, which means "the user gave up the connection" and would ask to close one that is
	 * already gone.
	 *
	 * Called on every roots refresh, so it covers every route a connection can close by, not just the
	 * ones the tree starts: a collapse, a deferred close once the last Data Explorer closed, an edit
	 * to the profile's parameters, or the driver dropping the connection on its own.
	 */
	private _dropClosedEntrySubtrees(entries: readonly DataConnectionEntry[]): void {
		for (const entry of entries) {
			const id = entryNodeId(entry.profile);
			if (entry.instance === undefined && this.hasLoadedChildren(id)) {
				super.collapse(id);
				this.dropLoadedChildren(id);
			}
		}
	}

	/**
	 * Fetches children for a node. For an entry node without a live instance, opens the
	 * connection first, then fetches the top-level DTOs against the new handle. Running this
	 * inside the base class's _fetchChildren means the loading state (twisty spinner) covers
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

	/**
	 * Renders one row. Each row gets callbacks bound to its own node id and position, so a row can
	 * act on itself without knowing anything about the tree.
	 *
	 * Reload (rather than invalidate) is required at every level: re-fetching a connection's
	 * top-level nodes invalidates every node handle the extension host has issued for that
	 * connection, and re-fetching an interior node's children issues new handles for them. In
	 * both cases the descendants loaded under the old handles are stale, so they're dropped and
	 * re-fetched rather than left in place. Reload restores the expansion the user had open (see
	 * reloadKey for how a node is matched to its post-refresh counterpart).
	 */
	private _renderRow(visible: VisibleNode<DataConnectionNode>, context: TreeNodeContext): ReactNode {
		const { id, data } = visible.node;

		// Fire-and-forget: reload drives the twisty's loading state and records any failure
		// against the node, so there's nothing for the row to await.
		// Offered whatever the node's expansion state: on an expanded node the subtree visibly
		// swaps, and on a collapsed one the stale children are dropped so the next expand fetches
		// from the source. Nothing is on screen beneath a collapsed node, so the absence of a
		// visible change there isn't the silent no-op it would be on an expanded one.
		const onRefresh = () => { void this.reload(id); };

		// Fire-and-forget for the same reason as refresh: the row has nothing to await. The entry's
		// connected indicator and subtree follow from the instance change the disconnect fires.
		const onDisconnect = () => { void this.disconnectEntry(id); };

		// Rows announce their context menu here rather than selecting themselves directly, so the
		// tree owns what opening a menu means: select the row the menu belongs to (as a left click
		// would), and keep the tree looking focused while the menu holds DOM focus. The returned
		// handle is disposed when the menu closes.
		const onMenuOpening = () => {
			void this.mouseSelectRow(context.index, MouseSelectionType.Single);
			return this.holdFocusAppearance();
		};

		switch (data.kind) {
			case 'entry':
				// Entries are roots, so no ancestor can be refreshing them out from under the row.
				return <DataConnectionEntryRow entry={data.entry} onDisconnect={onDisconnect} onMenuOpening={onMenuOpening} onRefresh={onRefresh} />;
			case 'dto':
				return <DataConnectionNodeRow dto={data.dto} handle={data.handle} stale={visible.stale} onMenuOpening={onMenuOpening} onRefresh={onRefresh} />;
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
 * saved profile, followed by one per discovered connection; the entry's instance is set when a live
 * connection exists for that profile.
 *
 * Discovered connections come last so a user's own saved connections keep the top of the pane: on a
 * machine with a large odbc.ini the discoveries can outnumber them several times over.
 */
function buildEntries(service: IPositronDataConnectionsService): DataConnectionEntry[] {
	return [...service.getProfiles(), ...service.getDiscoveredProfiles()].map(profile => ({
		profile,
		instance: service.getInstanceForProfile(profile.id),
	}));
}
