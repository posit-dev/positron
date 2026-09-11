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
import { POSITRON_DATA_CONNECTIONS_MINIMUM_INDENT_WIDTH, POSITRON_DATA_CONNECTIONS_TREE_INDENT_KEY, POSITRON_DATA_CONNECTIONS_TREE_SHOW_SINGLE_SCHEMA_KEY } from '../positronDataConnectionsConfiguration.js';
import { CONTAINER_ONLY_KINDS } from '../../../../services/positronDataConnections/common/dataConnectionSchemaSummary.js';
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
	| {
		readonly kind: 'dto';
		readonly dto: IDataConnectionNodeDTO;
		readonly handle: IDataConnectionHandle;

		// The name of the namespace group this node was breadcrumbed into, set when the node was
		// that group's only child. Rendered ahead of the node's own name, as "Schemas / public".
		readonly labelPrefix?: string;
	};

/**
 * The schemas group kind. Called out on its own because it is the one namespace tier that is hidden
 * outright when it holds a single schema, rather than breadcrumbed like the rest -- see
 * POSITRON_DATA_CONNECTIONS_TREE_SHOW_SINGLE_SCHEMA_KEY, the opt-in that brings it back.
 */
const SCHEMAS_GROUP_KIND = 'group-schemas';

/**
 * Group kinds that name a namespace tier -- the levels a connection is organized by, above the
 * objects themselves. A group of these kinds holding exactly one child is breadcrumbed into that
 * child, because it is pure ceremony: "Schemas" over a lone "public" costs a level and a click to
 * say something the row beneath it already says.
 *
 * Deliberately not every container kind. A lone "Tables" or "Columns" group still tells the user
 * what the single row beneath it is, which the row itself does not.
 */
const BREADCRUMB_GROUP_KINDS = new Set([
	'group-databases',
	'group-catalogs',
	SCHEMAS_GROUP_KIND,
]);

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
	// Zero is this view's "inherit the workbench setting" sentinel rather than a width, and anything
	// under the workbench key's own floor of 4 is treated the same way: a JSON schema can't express
	// "0, or 4 through 40", and at an indent of 1 or 2 the guides tile into a solid bar.
	const viewIndentWidth = configurationService.getValue<number>(POSITRON_DATA_CONNECTIONS_TREE_INDENT_KEY);
	return viewIndentWidth >= POSITRON_DATA_CONNECTIONS_MINIMUM_INDENT_WIDTH
		? viewIndentWidth
		: configurationService.getValue<number>(TREE_INDENT_KEY);
};

const wrapDto = (
	dto: IDataConnectionNodeDTO,
	handle: IDataConnectionHandle,
	labelPrefix?: string
): TreeNode<DataConnectionNode> => ({
	id: dtoNodeId(handle, dto),
	data: { kind: 'dto', dto, handle, labelPrefix },
	hasChildren: dto.hasGetChildren,
	// A group node names a category rather than a thing it holds, so it keeps its children at its
	// own indent: "Tables" above a list of tables already says what they are, and spending a level
	// to repeat it is what makes a column sit eight steps in. The same set decides which nodes the
	// schema summarizer flattens, for the same reason.
	flattensChildren: CONTAINER_ONLY_KINDS.has(dto.kind),
	// Both ways this tree drops a level get marked: a group holding its children at its own indent,
	// and a row breadcrumbed together with the group above it. They read as one thing to the user --
	// a row standing where two levels used to be -- however differently they got there.
	foldsLevel: CONTAINER_ONLY_KINDS.has(dto.kind) || labelPrefix !== undefined,
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
	// Children the breadcrumb look-ahead fetched for a namespace group that went on to keep its row,
	// held until that group is expanded so the user's own expand doesn't repeat the query. Keyed by
	// the group's node id, which carries the node handle the fetch minted, so an entry can only ever
	// be read by the row it was fetched for. See _breadcrumbNamespaceGroups and _takeLookAhead.
	private readonly _lookAheadChildren = new Map<string, readonly IDataConnectionNodeDTO[]>();

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

			// Whether a lone schema is shown is decided by the fetch, so the rows already on screen
			// were built under the old answer and a reload is what re-decides them -- the same
			// re-decision a schema gaining or losing a sibling gets. Without it the setting would
			// appear to do nothing until the user reloaded the window, which for a display toggle
			// reads as a bug.
			if (e.affectsConfiguration(POSITRON_DATA_CONNECTIONS_TREE_SHOW_SINGLE_SCHEMA_KEY)) {
				// Fire and forget, as the panel's own Refresh button does: nothing here can act on
				// the result, and a failed reload surfaces through the tree's per-node error state.
				void this.reloadAll();
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
		await this._expandBreadcrumbed();
	}

	/**
	 * Reloads a subtree. Breadcrumbing is decided by the fetch, so a reload re-decides it: a schema
	 * that has gained a sibling comes back as an ordinary "Schemas" group, and one that has lost its
	 * siblings comes back breadcrumbed.
	 *
	 * Deliberately does not auto-open breadcrumbed rows the way a first expand does. The base
	 * restores the expansion the user had, matching rows to their counterparts by reload key rather
	 * than by id, so a reload already reopens the breadcrumbed rows that were open and leaves the
	 * ones the user had closed alone. Running the auto-open on top of that would reopen the closed
	 * ones, since after a reload they are indistinguishable from rows appearing for the first time.
	 */
	override async reload(id: string): Promise<void> {
		this._lookAheadChildren.clear();
		await super.reload(id);
	}

	/**
	 * Reloads every connection. Same breadcrumb re-decision, and the same deference to the base's
	 * expansion restoration, as reload.
	 */
	override async reloadAll(): Promise<void> {
		this._lookAheadChildren.clear();
		await super.reloadAll();
	}

	/**
	 * Re-fetches a subtree in place. Reaches the same fetch as expand and reload, so it can
	 * breadcrumb too, and opens whatever it produced.
	 */
	override async invalidate(id?: string): Promise<void> {
		await super.invalidate(id);
		await this._expandBreadcrumbed();
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

				// The dropped subtree's node handles die with the connection, so anything the
				// look-ahead is still holding for it is unusable. Cleared wholesale rather than per
				// connection: the entries are keyed by node id, which cannot be mapped back to a
				// connection that is already gone, and the cost of clearing is one repeated query
				// on some other connection's next expand.
				this._lookAheadChildren.clear();
			}
		}
	}

	/**
	 * Fetches children for a node. For an entry node without a live instance, opens the
	 * connection first, then fetches the top-level DTOs against the new handle. Running this
	 * inside the base class's _fetchChildren means the loading state (twisty spinner) covers
	 * the connect + getChildren as one continuous operation, and a connect failure surfaces
	 * through the tree's existing error state.
	 *
	 * A namespace group that kept its row is answered from what the look-ahead already fetched for
	 * it, so opening it costs nothing rather than repeating that query.
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
				return this._breadcrumbNamespaceGroups(dtos, instance.connectionHandle);
			}
			case 'dto': {
				const dtos = this._takeLookAhead(node.id)
					?? await data.handle.nodeGetChildren(data.dto.nodeHandle);
				return this._breadcrumbNamespaceGroups(dtos, data.handle);
			}
		}
	}

	/**
	 * Returns the children the look-ahead fetched for a node, if it has any waiting, and forgets
	 * them. Taken rather than read: the entry answers exactly one fetch, so a later re-fetch of the
	 * same node goes to the source and sees anything that has changed since.
	 *
	 * @param id The node id to take the look-ahead result for.
	 * @returns The children, or undefined when the look-ahead has nothing for this node.
	 */
	private _takeLookAhead(id: string): readonly IDataConnectionNodeDTO[] | undefined {
		const children = this._lookAheadChildren.get(id);
		this._lookAheadChildren.delete(id);
		return children;
	}

	/**
	 * Wraps a level's DTOs, breadcrumbing any namespace group that turned out to hold exactly one
	 * child: the group is dropped and its child takes its place, labeled with the group's name
	 * ("Schemas" over a lone "public" becomes "Schemas / public"). See BREADCRUMB_GROUP_KINDS for
	 * which groups qualify and why, and _expandBreadcrumbed for how the replacement comes to be open.
	 *
	 * Deciding this needs the group's children, so a namespace group costs one extra round trip on
	 * the level above it, paid whether or not the user goes on to open it.
	 *
	 * A lone schema goes further than breadcrumbing and disappears altogether, unless the user has
	 * opted to keep it -- see _elideSingleSchema. That is why this returns a level rather than a
	 * node per DTO: one group can expand into the several rows that stood beneath it.
	 *
	 * @param dtos The level's DTOs.
	 * @param handle The connection handle the DTOs came from.
	 * @returns The level's tree nodes, with qualifying groups replaced by their only child, or by
	 * that child's own children when the schema tier is being hidden.
	 */
	private async _breadcrumbNamespaceGroups(
		dtos: readonly IDataConnectionNodeDTO[],
		handle: IDataConnectionHandle
	): Promise<readonly TreeNode<DataConnectionNode>[]> {
		const level = await Promise.all(dtos.map(async dto => {
			if (!BREADCRUMB_GROUP_KINDS.has(dto.kind) || !dto.hasGetChildren) {
				return [wrapDto(dto, handle)];
			}

			let children: readonly IDataConnectionNodeDTO[];
			try {
				children = await handle.nodeGetChildren(dto.nodeHandle);
			} catch {
				// The look-ahead is an optimization, so a failure just leaves the group as an
				// ordinary row. Expanding it will run the same call again and surface the error
				// through the tree's own error state, where the user can retry it.
				return [wrapDto(dto, handle)];
			}

			if (children.length === 1) {
				if (dto.kind === SCHEMAS_GROUP_KIND && !this._showSingleSchema()) {
					const contents = await this._elideSingleSchema(children[0], handle);
					if (contents !== undefined) {
						return contents;
					}
				}
				return [wrapDto(children[0], handle, dto.name)];
			}

			// The group keeps its row, and the children the look-ahead just fetched are the ones its
			// expand would ask for, so they are held for that expand to consume rather than queried
			// twice. On a warehouse connection that second query is seconds, at every namespace
			// level, on every reload.
			//
			// Held to the side rather than handed straight to the tree with setChildren: that writes
			// into the live children map, and this also runs inside a reload's staged fetch, whose
			// result is discarded if its node was collapsed while the fetch was in flight. The
			// entries would outlive the rows they belong to.
			const group = wrapDto(dto, handle);
			this._lookAheadChildren.set(group.id, children);
			return [group];
		}));

		return level.flat();
	}

	/**
	 * Whether the user has asked to keep a connection's only schema in the tree, breadcrumbed into
	 * its group, rather than have it dropped. Read live rather than cached in the constructor, so a
	 * toggle takes effect on the next fetch; the constructor's change handler reloads to make that
	 * immediate. Compared against true so that an unset value -- and a configuration service that
	 * does not know the key -- reads as the registered default of off.
	 */
	private _showSingleSchema(): boolean {
		return this._configurationService.getValue<boolean>(
			POSITRON_DATA_CONNECTIONS_TREE_SHOW_SINGLE_SCHEMA_KEY) === true;
	}

	/**
	 * Drops a lone schema out of the tree, returning the rows that stand in its place: its own
	 * children, spliced into the level where its "Schemas" group would have been. Two tiers vanish
	 * at once, so a connection to a single-schema database reads straight from the connection to
	 * Tables and Views.
	 *
	 * This costs a second look-ahead -- the group's children found the schema, and this fetches the
	 * schema's -- so opening a single-schema connection is three sequential round trips rather than
	 * two. That is the price of the default; the result is not wasted, since these are the rows the
	 * level goes on to hold. Turning the setting on takes the second one back off.
	 *
	 * Returns undefined when the schema cannot stand aside, leaving the caller to breadcrumb it as
	 * usual. A schema with no children is one of those cases: eliding it would leave the connection
	 * looking like it holds nothing, which reads as a failed connection rather than an empty schema.
	 *
	 * @param schema The lone schema DTO.
	 * @param handle The connection handle the DTO came from.
	 * @returns The schema's children as this level's rows, or undefined to fall back.
	 */
	private async _elideSingleSchema(
		schema: IDataConnectionNodeDTO,
		handle: IDataConnectionHandle
	): Promise<readonly TreeNode<DataConnectionNode>[] | undefined> {
		if (!schema.hasGetChildren) {
			return undefined;
		}

		let contents: readonly IDataConnectionNodeDTO[];
		try {
			contents = await handle.nodeGetChildren(schema.nodeHandle);
		} catch {
			// Same reasoning as the group look-ahead above: a failed optimization falls back to the
			// visible row, where expanding it runs the call again and surfaces the error.
			return undefined;
		}

		if (contents.length === 0) {
			return undefined;
		}

		return contents.map(dto => wrapDto(dto, handle));
	}

	/**
	 * Opens the breadcrumbed rows that are on screen and still closed. A breadcrumbed row stands in
	 * for a group the user would have had to expand anyway, so leaving it shut would just move the
	 * click down a row. Its children were not part of the look-ahead -- that fetched the group's
	 * children, which is the row itself -- so each one costs a round trip of its own.
	 *
	 * Read from the projection rather than from a list built during the fetch. Reloads run
	 * concurrently (reloadAll fans out across roots) and invalidate reaches the same fetch, so a list
	 * handed between the two is drained by whichever operation finishes first, against rows another
	 * one has not inserted yet. The projection is the same answer whoever asks and whenever.
	 *
	 * A row the user has closed is left closed, and having loaded children is what tells the two
	 * apart: a row that has never been opened has none, and one the user opened and then closed
	 * keeps them (a collapse does not drop them). Deliberately not a set of ids the tree has already
	 * opened -- the extension host mints a fresh node handle every time it serializes a node, so a
	 * row's id changes on every fetch and such a set would treat every replacement row as unseen.
	 * The reload path avoids the question entirely by leaving expansion to the base, which matches
	 * rows by reload key; see reload.
	 */
	private async _expandBreadcrumbed(): Promise<void> {
		const toExpand = this.visibleNodes
			.filter(visible =>
				visible.node.data.kind === 'dto' &&
				visible.node.data.labelPrefix !== undefined &&
				!this.isExpanded(visible.node.id) &&
				!this.hasLoadedChildren(visible.node.id))
			.map(visible => visible.node.id);

		await Promise.all(toExpand.map(id => this.expand(id)));
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
				return <DataConnectionNodeRow dto={data.dto} handle={data.handle} labelPrefix={data.labelPrefix} stale={visible.stale} onMenuOpening={onMenuOpening} onRefresh={onRefresh} />;
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
