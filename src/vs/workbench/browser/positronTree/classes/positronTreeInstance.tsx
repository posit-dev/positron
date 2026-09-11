/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronTreeInstance.css';

// React.
import { CSSProperties, JSX, ReactNode, MouseEvent as ReactMouseEvent } from 'react';

// Other dependencies.
import { Emitter, Event } from '../../../../base/common/event.js';
import { disposableTimeout, Limiter } from '../../../../base/common/async.js';
import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { DataGridInstance, MouseSelectionType, RowSelectionState, SelectionCursorOptions, selectionCursorOptions } from '../../positronDataGrid/classes/dataGridInstance.js';
import { TreeNode, TreeNodeContext, VisibleNode } from './treeNode.js';
import { buildVisibleNodes, findParentIndex } from './treeProjection.js';

/**
 * Inline-style shape for a row's indent spacer. Extends CSSProperties with the custom property that
 * carries the indent width to the stylesheet, so TypeScript accepts the literal without a cast.
 */
interface PositronTreeIndentCSSProperties extends CSSProperties {
	'--positron-tree-indent-width': string;
}

/**
 * PositronTreeRenderNode type. The consumer-provided function that renders the content area of
 * a single tree row. The framework provides the indent + twisty + selection background; this
 * function returns only what goes inside the row (label, icon, secondary text, etc.).
 */
export type PositronTreeRenderNode<T> = (visible: VisibleNode<T>, context: TreeNodeContext) => ReactNode;

/**
 * PositronTreeGetRoots type. Async fetcher for the root nodes of the tree.
 */
export type PositronTreeGetRoots<T> = () => Promise<readonly TreeNode<T>[]>;

/**
 * PositronTreeGetChildren type. Async fetcher for the children of a single node. Called when
 * the user expands a node whose children have not yet been loaded.
 */
export type PositronTreeGetChildren<T> = (node: TreeNode<T>) => Promise<readonly TreeNode<T>[]>;

/**
 * PositronTreeGetReloadKey type. Returns the identity a node keeps across a reload, used to match
 * a pre-reload node to its post-reload counterpart among its siblings so reload() can restore
 * expansion. Defaults to the node id, which is correct whenever ids are derived from the data
 * itself. Supply this when ids carry per-fetch state (a handle, a sequence number) and so change
 * on every fetch even though the node they describe hasn't.
 */
export type PositronTreeGetReloadKey<T> = (node: TreeNode<T>) => string;

/**
 * PositronTreeBaseOptions type. The tree options other than the cursor/commit options, which come
 * from SelectionCursorOptions (see PositronTreeInstanceOptions).
 */
interface PositronTreeBaseOptions<T> {
	// Async fetcher for the root nodes.
	readonly getRoots: PositronTreeGetRoots<T>;

	// Async fetcher for a node's children. Called on first expand.
	readonly getChildren: PositronTreeGetChildren<T>;

	// Renderer for the row content area.
	readonly renderNode: PositronTreeRenderNode<T>;

	// Cross-reload identity for a node. Defaults to the node id. See PositronTreeGetReloadKey.
	readonly getReloadKey?: PositronTreeGetReloadKey<T>;

	// Row height in pixels.
	readonly rowHeight: number;

	// Per-level indent width in pixels.
	readonly indentWidth: number;

	// Whether to apply default focused/selected styling on the row wrapper. Defaults to true.
	readonly useDefaultStyling?: boolean;
}

/**
 * PositronTreeInstanceOptions type. Defaults to not tracking the cursor: the cursor (focus) moves
 * independently and Enter/Space commit the selection to the cursor row (both default to true). Set
 * selectionFollowsCursor true to make the selection follow the cursor on every move, in which case
 * Enter/Space-to-select are redundant and disallowed.
 */
export type PositronTreeInstanceOptions<T> = PositronTreeBaseOptions<T> & SelectionCursorOptions;

/**
 * How long, in milliseconds, the rows a reload brought in stay marked as recently refreshed. Set
 * just past the CSS animation that renders the mark (see positronTreeInstance.css) so the rows
 * finish easing out before the class comes off, with no visible pop at the end.
 */
const REFRESHED_HIGHLIGHT_DURATION = 1500;

/**
 * How many getChildren calls a reload runs at once while restoring expansion. Enough to keep a
 * wide restore prompt, low enough that refreshing a connection with dozens of expanded nodes
 * doesn't fan out into dozens of simultaneous queries against the source.
 */
const RESTORE_FETCH_CONCURRENCY = 8;

/**
 * ExpansionSnapshot type. The shape of an expanded subtree, captured before a reload drops it.
 * Each level maps a child's reload key to that child's own snapshot; only expanded children are
 * present, so the snapshot mirrors exactly what the user had open.
 */
interface ExpansionSnapshot {
	readonly children: Map<string, ExpansionSnapshot>;
}

/**
 * SubtreeFetch type. A reloaded subtree, fetched in full before any of it is applied to the tree.
 * Holding the whole result until it's ready is what lets a reload swap the subtree in one
 * projection rebuild, instead of emptying the rows and refilling them level by level.
 */
interface SubtreeFetch<T> {
	// The reloaded node's new children.
	readonly children: readonly TreeNode<T>[];

	// Loaded children for each restored descendant, keyed by its (new) node id.
	readonly descendants: Map<string, readonly TreeNode<T>[]>;

	// The restored descendants to mark expanded.
	readonly expanded: Set<string>;
}

/**
 * PositronTreeInstance class. A virtualized, async tree control built as a single-column
 * subclass of DataGridInstance. The instance owns the tree state (roots, expansion, loading,
 * errors, loaded children) and projects it to a flat list of visible rows that the data grid
 * machinery virtualizes and renders.
 *
 * Loaded children stay resident in memory until their parent is collapsed and explicitly
 * invalidated. Memory and virtualization are orthogonal: the projection contains only visible
 * rows, but the children map can hold large loaded subtrees.
 */
export class PositronTreeInstance<T> extends DataGridInstance {
	//#region Private Properties

	// Caller-supplied async fetchers and row renderer.
	private _getRoots: PositronTreeGetRoots<T>;
	private _getChildren: PositronTreeGetChildren<T>;
	private _renderNode: PositronTreeRenderNode<T>;

	// Cross-reload identity for a node.
	private readonly _getReloadKey: PositronTreeGetReloadKey<T>;

	// Per-level indent width in pixels and whether to apply default focus/selection styling.
	private _indentWidth: number;
	private readonly _useDefaultStyling: boolean;

	// Structural tree state.
	private _roots: readonly TreeNode<T>[] = [];
	private readonly _children = new Map<string, readonly TreeNode<T>[]>();
	private readonly _expanded = new Set<string>();
	private readonly _loading = new Set<string>();
	private readonly _errors = new Map<string, unknown>();

	// Nodes with a reload in flight. Kept apart from _loading because a reload leaves the
	// existing rows on screen -- only the twisty changes -- until the new subtree is committed.
	private readonly _refreshing = new Set<string>();

	// Nodes a reload just swapped in, each stamped with the generation of the reload that marked
	// it, held for REFRESHED_HIGHLIGHT_DURATION so the rows can show that the refresh landed. The
	// stamp is what lets overlapping reloads coexist -- see _markRecentlyRefreshed.
	private readonly _recentlyRefreshed = new Map<string, number>();

	// Incremented for each batch of marks, so every batch is distinguishable from the last.
	private _refreshGeneration = 0;

	// Pending fetch promises keyed by node id. Re-entrant expand() / invalidate() calls return
	// the in-flight promise rather than starting a second fetch.
	private readonly _pendingChildrenFetches = new Map<string, Promise<void>>();

	// Pending reloads keyed by node id. A second reload() for a node already reloading joins the
	// in-flight one rather than starting a competing fetch of the same subtree.
	private readonly _pendingReloads = new Map<string, Promise<void>>();

	// Pending whole-tree reload. Same idea for reloadAll, which spans every root.
	private _pendingReloadAll: Promise<void> | undefined;

	// Pending roots fetch. Same idea for getRoots / refresh.
	private _pendingRootsFetch: Promise<void> | undefined;

	// The current flat projection. Rebuilt whenever structural state changes.
	private _visibleNodes: readonly VisibleNode<T>[] = [];

	// Whether the initial roots load has completed at least once. Lets consumers distinguish
	// "loading initial data" from "no roots."
	private _initialLoadCompleted = false;

	// Outstanding focus holds. See holdFocusAppearance.
	private _focusHolds = 0;

	// Fires when the tree's loading state changes (initial load, roots fetch, or per-node fetch).
	private readonly _onDidChangeLoadingEmitter = this._register(new Emitter<void>());

	//#endregion Private Properties

	//#region Public Events

	// Fires when loading state changes.
	readonly onDidChangeLoading: Event<void> = this._onDidChangeLoadingEmitter.event;

	//#endregion Public Events

	//#region Constructor

	constructor(options: PositronTreeInstanceOptions<T>) {
		super({
			columnHeaders: false,
			rowHeaders: false,
			defaultColumnWidth: 0,
			defaultRowHeight: options.rowHeight,
			columnResize: false,
			rowResize: false,
			columnPinning: false,
			rowPinning: false,
			horizontalScrollbar: false,
			verticalScrollbar: true,
			scrollbarThickness: 8,
			scrollbarOverscroll: 0,
			useEditorFont: false,
			automaticLayout: true,
			cellBorders: false,
			internalCursor: false,
			selection: true,
			selectionMode: 'list-single-selection',
			...selectionCursorOptions(options),
		});

		this._getRoots = options.getRoots;
		this._getChildren = options.getChildren;
		this._renderNode = options.renderNode;
		this._getReloadKey = options.getReloadKey ?? (node => node.id);
		this._indentWidth = options.indentWidth;
		this._useDefaultStyling = options.useDefaultStyling ?? true;

		// Lock the column count to one.
		this._columnLayoutManager.setEntries(1);

		// Kick off the initial roots load. Fire-and-forget; the projection rebuilds and the grid
		// repaints when the promise resolves.
		void this.refresh();
	}

	//#endregion Constructor

	//#region Public Properties

	/**
	 * The per-level indent width, in pixels. A row at depth n is inset by n times this.
	 */
	get indentWidth(): number {
		return this._indentWidth;
	}

	get initialLoadCompleted(): boolean {
		return this._initialLoadCompleted;
	}

	get isLoadingRoots(): boolean {
		return this._pendingRootsFetch !== undefined;
	}

	get visibleNodes(): readonly VisibleNode<T>[] {
		return this._visibleNodes;
	}

	/**
	 * Whether the tree should render as focused. True while a focus hold is outstanding, even
	 * though DOM focus has moved elsewhere -- see holdFocusAppearance.
	 */
	override get focused(): boolean {
		return this._focusHolds > 0 || super.focused;
	}

	//#endregion Public Properties

	//#region Public Methods - Data

	/**
	 * Re-runs getRoots and replaces the roots. Pending children fetches are not cancelled --
	 * already-loaded subtrees are preserved by id where they still exist in the new roots.
	 */
	async refresh(): Promise<void> {
		if (this._pendingRootsFetch !== undefined) {
			return this._pendingRootsFetch;
		}

		const fetchPromise = (async () => {
			try {
				const roots = await this._getRoots();
				this._roots = roots;
			} catch (err) {
				// Roots fetch failed. Leave existing roots (if any) in place and record the
				// error against a synthetic 'roots' id so consumers can surface it.
				this._errors.set('__roots__', err);
			} finally {
				this._initialLoadCompleted = true;
				this._pendingRootsFetch = undefined;
				this._rebuildProjection();
				this._onDidChangeLoadingEmitter.fire();
			}
		})();

		this._pendingRootsFetch = fetchPromise;
		this._onDidChangeLoadingEmitter.fire();
		return fetchPromise;
	}

	/**
	 * Invalidates a subtree (or the whole tree if no id is supplied). For an id whose children
	 * are already loaded, re-runs getChildren and replaces the entry. For an unknown id, no-op.
	 */
	async invalidate(id?: string): Promise<void> {
		if (id === undefined) {
			return this.refresh();
		}

		// If the node's children aren't loaded, there's nothing to invalidate.
		if (!this._children.has(id)) {
			return;
		}

		// Find the node so we can pass it to getChildren.
		const node = this._findNode(id);
		if (node === undefined) {
			return;
		}

		this._errors.delete(id);
		await this._fetchChildren(node);
	}

	/**
	 * Reloads a node's subtree from the source, replacing the loaded children of the node and all
	 * of its loaded descendants -- releasing any per-fetch resources they hold.
	 *
	 * The subtree is fetched in full off to the side and swapped in as a single update, so the
	 * rows on screen stay put and change over in one frame. The node reports `refreshing` while
	 * the fetch runs (see VisibleNode) and its existing children remain visible throughout;
	 * nothing is torn down before the replacement is in hand.
	 *
	 * The expansion the user had open is preserved: every expanded descendant is captured up
	 * front and re-fetched as part of the reload, for each one whose counterpart is still there.
	 * Descendants that no longer exist are simply not restored, and ones that appeared while the
	 * tree was open stay collapsed. Nodes are matched to their counterparts by reload key (see
	 * PositronTreeGetReloadKey), not by id, so the restore survives sources that mint a fresh id
	 * for a node on every fetch.
	 *
	 * A collapsed node has nothing on screen to preserve, so it just drops its stale children and
	 * re-fetches them on its next expand. If the reload's top-level fetch fails, the stale
	 * subtree is dropped and the error is recorded against the node, matching a failed expand --
	 * the twisty surfaces the message and toggling the node retries.
	 *
	 * Differs from invalidate, which re-fetches a single level and leaves already-loaded
	 * descendants in place. Reach for reload when the descendants can't be trusted after the
	 * re-fetch -- either because their data is derived from the parent's, or because the
	 * re-fetch invalidates the resources they were loaded with.
	 */
	async reload(id: string): Promise<void> {
		const node = this._findNode(id);
		if (node === undefined || !node.hasChildren) {
			return;
		}

		// Nothing is on screen beneath a collapsed node, so there's no swap to stage: drop the
		// stale children and let the next expand fetch them.
		if (!this._expanded.has(id)) {
			this.dropLoadedChildren(id);
			return;
		}

		// Re-entrant: join the in-flight reload if one is already running for this id.
		const existing = this._pendingReloads.get(id);
		if (existing !== undefined) {
			return existing;
		}

		const expansion = this._captureExpansion(id);

		this._refreshing.add(id);
		this._rebuildProjection();
		this._onDidChangeLoadingEmitter.fire();

		const reloadPromise = (async () => {
			try {
				const fetched = await this._fetchSubtree(node, expansion);

				// The tree can move on while the fetch is in flight: the node may have been
				// collapsed -- which for some consumers also releases the very resources the
				// fetch used -- or dropped from the tree outright. Installing the result then
				// would resurrect a subtree the tree has abandoned, and because expand() doesn't
				// re-fetch a node whose children are already loaded, those rows would never be
				// replaced. Discarding leaves the node unloaded, so its next expand fetches
				// afresh.
				if (this._expanded.has(id) && this._findNode(id) !== undefined) {
					this._applySubtree(id, fetched);
				}
			} catch (err) {
				// The node's own fetch failed, so there's no replacement subtree to swap in.
				// Drop the stale one and record the error: leaving the children in place would
				// strand the node in a permanent error state, since re-expanding a node whose
				// children are already loaded doesn't re-fetch (and so never clears the error).
				this._dropLoadedChildren(id);
				this._errors.set(id, err);
				console.error(`[PositronTree] reload failed for node ${id}:`, err);
			} finally {
				this._refreshing.delete(id);
				this._pendingReloads.delete(id);
				this._rebuildProjection();
				this._onDidChangeLoadingEmitter.fire();
			}
		})();

		this._pendingReloads.set(id, reloadPromise);
		return reloadPromise;
	}

	/**
	 * Reloads everything on screen: re-runs getRoots, then reloads the subtree under every expanded
	 * root, so the whole visible tree comes back from the source. Expansion is preserved and each
	 * subtree swaps in as a unit, exactly as a per-node reload does.
	 *
	 * Differs from refresh, which re-runs getRoots and leaves the loaded subtrees alone.
	 *
	 * Re-entrant, like refresh and reload: calling it again while one is running joins that pass
	 * rather than starting a second sweep of the tree. That lets a consumer leave its refresh
	 * control enabled and simply let the extra activations fold into the run already going --
	 * preferable to disabling the control, since clicking a disabled control moves focus to its
	 * container and leaves a focus ring behind.
	 */
	async reloadAll(): Promise<void> {
		if (this._pendingReloadAll !== undefined) {
			return this._pendingReloadAll;
		}

		const reloadAllPromise = (async () => {
			try {
				await this.refresh();

				// Roots are independent sources, so they reload concurrently; each reload bounds the
				// fan-out of its own descendant fetches. Collapsed roots have nothing on screen and
				// just drop their stale children, so the next expand fetches afresh.
				await Promise.all(this._roots.map(root => this.reload(root.id)));
			} finally {
				this._pendingReloadAll = undefined;
			}
		})();

		this._pendingReloadAll = reloadAllPromise;
		return reloadAllPromise;
	}

	/**
	 * Whether a reload of the given node's subtree is in flight.
	 */
	isRefreshing(id: string): boolean {
		return this._refreshing.has(id);
	}

	/**
	 * Whether the given node's children are currently loaded. A node keeps its loaded children while
	 * collapsed, so consumers whose children carry per-fetch resources can use this to tell whether
	 * there is anything to drop (see {@link dropLoadedChildren}).
	 */
	hasLoadedChildren(id: string): boolean {
		return this._children.has(id);
	}

	/**
	 * Push escape hatch: replace the roots without going through getRoots. Used when the
	 * consumer has the data in hand (e.g. a sync event source).
	 */
	setRoots(roots: readonly TreeNode<T>[]): void {
		this._roots = roots;
		this._initialLoadCompleted = true;
		this._errors.delete('__roots__');
		this._rebuildProjection();
	}

	/**
	 * Push escape hatch: replace a node's children without going through getChildren. The
	 * parent is implicitly marked as having its children loaded (i.e. eligible for the
	 * 'expanded' state if it's in the expanded set).
	 */
	setChildren(parentId: string, children: readonly TreeNode<T>[]): void {
		this._children.set(parentId, children);
		this._errors.delete(parentId);
		this._loading.delete(parentId);
		this._rebuildProjection();
	}

	/**
	 * Drops the loaded children for the given node and all of its loaded descendants. After this
	 * call, the node is back to "expandable, not loaded" -- the next expand re-fetches. Also
	 * clears any cached errors on the affected ids and removes them from the expanded set so the
	 * subtree collapses visually.
	 *
	 * Used by consumers whose loaded children carry per-fetch resources (e.g. a connection
	 * handle) that have become stale and need to be re-fetched against a fresh resource.
	 */
	dropLoadedChildren(id: string): void {
		this._dropLoadedChildren(id);
		this._rebuildProjection();
	}

	//#endregion Public Methods - Data

	//#region Public Methods - Expansion

	async expand(id: string): Promise<void> {
		if (this._expanded.has(id)) {
			return;
		}

		const node = this._findNode(id);
		if (node === undefined || !node.hasChildren) {
			return;
		}

		this._expanded.add(id);

		// If we already have children loaded for this node, no fetch needed.
		if (this._children.has(id)) {
			this._rebuildProjection();
			return;
		}

		await this._fetchChildren(node);
	}

	collapse(id: string): void {
		if (!this._expanded.has(id)) {
			return;
		}

		this._expanded.delete(id);
		this._rebuildProjection();
	}

	async toggle(id: string): Promise<void> {
		if (this._expanded.has(id)) {
			this.collapse(id);
		} else {
			await this.expand(id);
		}
	}

	isExpanded(id: string): boolean {
		return this._expanded.has(id);
	}

	isLoading(id: string): boolean {
		return this._loading.has(id);
	}

	getError(id: string): unknown {
		return this._errors.get(id);
	}

	//#endregion Public Methods - Expansion

	//#region Public Methods - Selection / Focus / Activation

	/**
	 * Returns the visible row id at the cursor, or undefined if the cursor is out of range.
	 */
	get focusedId(): string | undefined {
		return this._visibleNodes[this.cursorRowIndex]?.node.id;
	}

	/**
	 * Returns the currently-selected row's node, or undefined if no row is selected.
	 */
	getSelectedNode(): TreeNode<T> | undefined {
		for (let i = 0; i < this._visibleNodes.length; i++) {
			if (this.rowSelectionState(i) !== RowSelectionState.None) {
				return this._visibleNodes[i].node;
			}
		}
		return undefined;
	}

	//#endregion Public Methods - Selection / Focus / Activation

	//#region Public Methods - Renderer Update

	/**
	 * Sets the per-level indent width. Consumers that resolve their indent from a user setting call
	 * this when it changes. Indent width is presentation only: every row keeps its height and its
	 * place, so the projection is left alone and the rows are simply repainted at the new width.
	 *
	 * @param indentWidth The per-level indent width in pixels.
	 */
	setIndentWidth(indentWidth: number): void {
		if (indentWidth === this._indentWidth) {
			return;
		}

		this._indentWidth = indentWidth;
		this.fireOnDidUpdateEvent();
	}

	setRenderNode(renderNode: PositronTreeRenderNode<T>): void {
		this._renderNode = renderNode;
		this.fireOnDidUpdateEvent();
	}

	//#endregion Public Methods - Renderer Update

	//#region Public Methods - Focus

	/**
	 * Holds the tree in its focused appearance while something transient takes DOM focus away from
	 * it -- a row's context menu, typically. Without the hold the tree blurs the moment the menu
	 * opens, and the row the menu belongs to drops to the dimmer inactive-selection styling just
	 * as the user is looking at it.
	 *
	 * Dispose the returned handle when the overlay closes. Holds are counted, so overlapping
	 * overlays each keep their own; disposing a handle twice is a no-op.
	 */
	holdFocusAppearance(): IDisposable {
		this._focusHolds++;
		this.fireOnDidUpdateEvent();

		let released = false;
		return toDisposable(() => {
			if (released) {
				return;
			}
			released = true;
			this._focusHolds--;
			this.fireOnDidUpdateEvent();
		});
	}

	//#endregion Public Methods - Focus

	//#region Private Methods

	private _findNode(id: string): TreeNode<T> | undefined {
		// Search roots, then walk into loaded children. The id is unique across the whole tree,
		// so first match wins.
		const stack: (readonly TreeNode<T>[])[] = [this._roots];
		while (stack.length > 0) {
			const siblings = stack.pop()!;
			for (const node of siblings) {
				if (node.id === id) {
					return node;
				}
				const loaded = this._children.get(node.id);
				if (loaded !== undefined) {
					stack.push(loaded);
				}
			}
		}
		return undefined;
	}

	/**
	 * Captures the expanded shape of the loaded subtree under the given node, keyed by reload key.
	 * Only expanded children are recorded, and the walk descends only through them -- a collapsed
	 * node's own children were never on screen, so there's nothing to restore beneath it.
	 */
	private _captureExpansion(id: string): ExpansionSnapshot {
		const children = new Map<string, ExpansionSnapshot>();
		for (const child of this._children.get(id) ?? []) {
			if (this._expanded.has(child.id)) {
				children.set(this._getReloadKey(child), this._captureExpansion(child.id));
			}
		}
		return { children };
	}

	/**
	 * Fetches a node's children and, beneath them, the children of every descendant the snapshot
	 * says was expanded. Nothing is written to the tree's own state -- the result is assembled
	 * separately so the caller can apply it all at once.
	 */
	private async _fetchSubtree(node: TreeNode<T>, snapshot: ExpansionSnapshot): Promise<SubtreeFetch<T>> {
		const children = await this._getChildren(node);
		const fetched: SubtreeFetch<T> = { children, descendants: new Map(), expanded: new Set() };

		// Restoring a wide subtree can mean dozens of getChildren calls. Expansion has always been
		// serial -- the user opens one node at a time -- so an unbounded restore would put a burst
		// of concurrent work on a source that has never seen it from this tree. The limiter is
		// per-reload, and it wraps only the getChildren call, never the recursion beneath it: a
		// queued task that waited on another queued task could deadlock once the cap is reached.
		const limiter = new Limiter<readonly TreeNode<T>[]>(RESTORE_FETCH_CONCURRENCY);
		try {
			await this._fetchRestoredDescendants(children, snapshot, fetched, limiter);
		} finally {
			limiter.dispose();
		}

		return fetched;
	}

	/**
	 * Matches freshly fetched children against a captured snapshot and fetches the children of
	 * each match, recursing to the depth the snapshot records. A branch whose fetch fails is left
	 * out of the result -- it comes back collapsed and unloaded, so expanding it retries and
	 * surfaces the error there -- rather than failing the whole reload.
	 */
	private async _fetchRestoredDescendants(
		children: readonly TreeNode<T>[],
		snapshot: ExpansionSnapshot,
		fetched: SubtreeFetch<T>,
		limiter: Limiter<readonly TreeNode<T>[]>
	): Promise<void> {
		if (snapshot.children.size === 0) {
			return;
		}

		// Each key is consumed on first match, so siblings sharing a reload key are restored
		// one-to-one instead of all matching the same snapshot entry.
		const unmatched = new Map(snapshot.children);
		const fetches: Promise<void>[] = [];
		for (const child of children) {
			if (unmatched.size === 0) {
				break;
			}

			const key = this._getReloadKey(child);
			const childSnapshot = unmatched.get(key);
			if (childSnapshot === undefined || !child.hasChildren) {
				continue;
			}

			unmatched.delete(key);
			fetches.push((async () => {
				let grandchildren: readonly TreeNode<T>[];
				try {
					grandchildren = await limiter.queue(() => this._getChildren(child));
				} catch (err) {
					console.error(`[PositronTree] reload could not restore node ${child.id}:`, err);
					return;
				}
				fetched.descendants.set(child.id, grandchildren);
				fetched.expanded.add(child.id);
				await this._fetchRestoredDescendants(grandchildren, childSnapshot, fetched, limiter);
			})());
		}

		// Siblings fetch concurrently (up to the limiter's cap) -- they're independent, and none of
		// them is on screen yet.
		await Promise.all(fetches);
	}

	/**
	 * Swaps a fetched subtree in for the node's current one. Every mutation happens before the
	 * single projection rebuild, so the rows change over in one frame instead of emptying out and
	 * refilling.
	 */
	private _applySubtree(id: string, fetched: SubtreeFetch<T>): void {
		this._dropLoadedChildren(id);
		this._children.set(id, fetched.children);
		for (const [descendantId, children] of fetched.descendants) {
			this._children.set(descendantId, children);
		}
		for (const descendantId of fetched.expanded) {
			this._expanded.add(descendantId);
		}

		// The reloaded node together with everything the reload brought in beneath it -- the new
		// children and, under them, the children of each restored descendant.
		//
		// The node itself is included even though it wasn't replaced: the mark says "this was
		// refreshed", and a whole-tree reload that marked only descendants would leave the roots
		// looking untouched by the very action the user invoked on them.
		const installed = [...fetched.children, ...Array.from(fetched.descendants.values()).flat()];
		this._markRecentlyRefreshed([id, ...installed.map(node => node.id)]);
	}

	/**
	 * Marks a batch of nodes as recently refreshed and schedules the batch to clear on its own
	 * timer.
	 *
	 * Each id is stamped with this batch's generation, and the timer clears only the ids still
	 * carrying it. A node re-marked by a later reload therefore belongs to that reload, and the
	 * earlier timer leaves it alone -- without the stamp, an id present in both batches (any node
	 * whose id is stable across fetches, such as a root) would lose its highlight on the earlier
	 * timer, part way through the run it was owed.
	 *
	 * The generation is also what lets the row restart the highlight animation: see the
	 * alternating class names in cell().
	 */
	private _markRecentlyRefreshed(ids: readonly string[]): void {
		if (ids.length === 0) {
			return;
		}

		const generation = ++this._refreshGeneration;
		for (const id of ids) {
			this._recentlyRefreshed.set(id, generation);
		}

		// disposableTimeout removes itself from the store once it fires, so the store doesn't
		// accumulate spent timers over a long session -- and a disposed tree cancels the pending
		// ones instead of rebuilding a projection after teardown.
		disposableTimeout(() => {
			for (const id of ids) {
				if (this._recentlyRefreshed.get(id) === generation) {
					this._recentlyRefreshed.delete(id);
				}
			}
			this._rebuildProjection();
		}, REFRESHED_HIGHLIGHT_DURATION, this._store);
	}

	/**
	 * The body of dropLoadedChildren, without the projection rebuild, so a reload can drop the
	 * old subtree and install the new one within a single rebuild.
	 */
	private _dropLoadedChildren(id: string): void {
		// Walk the loaded subtree under `id` so descendants get cleaned too. The id itself is
		// not removed from any structural map -- it's the children we drop.
		const stack: string[] = [id];
		while (stack.length > 0) {
			const current = stack.pop()!;
			const loaded = this._children.get(current);
			if (loaded === undefined) {
				continue;
			}
			for (const child of loaded) {
				stack.push(child.id);
				this._expanded.delete(child.id);
				this._errors.delete(child.id);
				this._loading.delete(child.id);
			}
			this._children.delete(current);
		}
		this._errors.delete(id);
	}

	private async _fetchChildren(node: TreeNode<T>): Promise<void> {
		// Re-entrant: return the in-flight promise if a fetch is already running for this id.
		const existing = this._pendingChildrenFetches.get(node.id);
		if (existing !== undefined) {
			return existing;
		}

		this._loading.add(node.id);
		this._errors.delete(node.id);
		this._rebuildProjection();
		this._onDidChangeLoadingEmitter.fire();

		const fetchPromise = (async () => {
			try {
				const children = await this._getChildren(node);
				this._children.set(node.id, children);
			} catch (err) {
				this._errors.set(node.id, err);
				// Log so consumers don't have to drill into the projection to see why the error
				// twisty appeared. The error twisty's title also surfaces the message.
				console.error(`[PositronTree] getChildren failed for node ${node.id}:`, err);
			} finally {
				this._loading.delete(node.id);
				this._pendingChildrenFetches.delete(node.id);
				this._rebuildProjection();
				this._onDidChangeLoadingEmitter.fire();
			}
		})();

		this._pendingChildrenFetches.set(node.id, fetchPromise);
		return fetchPromise;
	}

	private _rebuildProjection(): void {
		this._visibleNodes = buildVisibleNodes<T>({
			roots: this._roots,
			expanded: this._expanded,
			loading: this._loading,
			errors: this._errors,
			children: this._children,
			refreshing: this._refreshing,
			recentlyRefreshed: this._recentlyRefreshed,
		});

		// All rows are the same height; the row layout manager just needs the count.
		this._rowLayoutManager.setEntries(this._visibleNodes.length);

		// If the cursor landed past the last visible row (e.g. after a collapse), pull it back.
		if (this._visibleNodes.length === 0) {
			// Nothing to focus.
		} else if (this.cursorRowIndex >= this._visibleNodes.length) {
			this.setCursorRow(this._visibleNodes.length - 1);
		}

		this.fireOnDidUpdateEvent();
	}

	//#endregion Private Methods

	//#region DataGridInstance Implementation

	get columns(): number {
		return 1;
	}

	get rows(): number {
		return this._visibleNodes.length;
	}

	override get scrollWidth(): number {
		return 0;
	}

	override get firstColumn() {
		return {
			columnIndex: 0,
			left: 0,
			width: 0,
		};
	}

	override getCustomColumnWidth(columnIndex: number): number | undefined {
		return columnIndex === 0 ? this.layoutWidth : undefined;
	}

	override async mouseSelectCell(
		_columnIndex: number,
		rowIndex: number,
		_pinned: boolean,
		mouseSelectionType: MouseSelectionType
	): Promise<void> {
		await this.mouseSelectRow(rowIndex, mouseSelectionType);
	}

	/**
	 * Tree-semantic left arrow:
	 * - If the focused row is expanded, collapse it.
	 * - Otherwise, move the cursor to the parent row.
	 *
	 * Overrides the data grid's column-left navigation (which is meaningless in a single-column
	 * tree). The override is sync to match the base signature; expand/collapse mutations are
	 * sync (the actual children fetch happens elsewhere).
	 */
	override moveCursorLeft(): void {
		const visible = this._visibleNodes[this.cursorRowIndex];
		if (visible === undefined) {
			return;
		}

		if (visible.expandState === 'expanded') {
			this.collapse(visible.node.id);
			return;
		}

		const parentIndex = findParentIndex(this._visibleNodes, this.cursorRowIndex);
		if (parentIndex !== undefined) {
			this.setCursorRow(parentIndex);
			this.scrollToCursor();
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Tree-semantic right arrow:
	 * - If the focused row is collapsed and expandable, expand it (fire-and-forget the fetch).
	 * - If the focused row is already expanded, move the cursor to its first child.
	 * - If it's a leaf or in error / loading state, do nothing.
	 */
	override moveCursorRight(): void {
		const visible = this._visibleNodes[this.cursorRowIndex];
		if (visible === undefined) {
			return;
		}

		if (visible.expandState === 'collapsed') {
			void this.expand(visible.node.id);
			return;
		}

		if (visible.expandState === 'expanded') {
			const firstChildIndex = this.cursorRowIndex + 1;
			const firstChild = this._visibleNodes[firstChildIndex];
			if (firstChild !== undefined && firstChild.depth === visible.depth + 1) {
				this.setCursorRow(firstChildIndex);
				this.scrollToCursor();
				this.fireOnDidUpdateEvent();
			}
		}
	}

	/**
	 * Renders a single row: indent + twisty + consumer content, wrapped for focus / selection.
	 */
	cell(columnIndex: number, rowIndex: number): JSX.Element | undefined {
		if (columnIndex !== 0) {
			return undefined;
		}

		const visible = this._visibleNodes[rowIndex];
		if (visible === undefined) {
			return undefined;
		}

		const selected = this.rowSelectionState(rowIndex) !== RowSelectionState.None;
		const cursor = this.cursorRowIndex === rowIndex;
		const treeFocused = this.focused;

		const onTwistyClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
			// Stop the click from bubbling to the row -- toggling shouldn't also select.
			e.stopPropagation();
			void this.toggle(visible.node.id);
		};

		// Nothing to toggle on a leaf, nothing to interrupt on a row already fetching, and a stale
		// row's twisty is inert because expanding it would fetch against a resource the ancestor's
		// refresh may already have released -- the subtree is about to be replaced wholesale anyway,
		// and the ancestor's spinner is what tells the user why.
		const twistyDisabled = visible.expandState === 'leaf'
			|| visible.expandState === 'loading'
			|| visible.stale;
		const errorMessage = visible.expandState === 'error' ? formatError(this._errors.get(visible.node.id)) : undefined;

		// A refreshing node spins in place: its expandState (and so its rows) are untouched while
		// the replacement subtree is fetched, and only the glyph reflects the work in flight.
		const twistyGlyphState = visible.refreshing ? 'loading' : visible.expandState;

		// The highlight alternates between two identical animations by generation parity. A CSS
		// animation restarts only when its animation-name changes, so a row that is still mid-run
		// when a second reload re-marks it would otherwise finish the old run and then sit at zero
		// opacity for the rest of the new one -- the second refresh would look like it did nothing.
		const refreshedClass = visible.recentlyRefreshed
			? (visible.refreshGeneration % 2 === 0 ? 'recently-refreshed-even' : 'recently-refreshed-odd')
			: undefined;

		// The spacer's width, plus the indent width the stylesheet tiles the indent guides at. The
		// guides are drawn on a pseudo-element, which an inline background-size can't reach, so the
		// width crosses over as a custom property.
		const indentStyle: PositronTreeIndentCSSProperties = {
			width: visible.indentLevel * this._indentWidth,
			'--positron-tree-indent-width': `${this._indentWidth}px`,
		};

		return (
			<div
				className={positronClassNames(
					'positron-tree-row',
					{ 'focused': this._useDefaultStyling && cursor && treeFocused },
					{ 'selected': this._useDefaultStyling && selected },
					refreshedClass
				)}
			>
				<div
					className={positronClassNames(
						'positron-tree-indent',
						{ 'flattened-parent-guide': visible.flattenedParentGuide }
					)}
					data-testid='positron-tree-indent'
					style={indentStyle}
				>
					{/*
					  * The connector joining a folded row to its parent's guide. A root row has no
					  * parent guide to join, so it gets none.
					  */}
					{visible.node.foldsLevel === true && visible.indentLevel > 0 &&
						<div className='positron-tree-fold-connector' />
					}
				</div>
				<button
					aria-label={twistyDisabled ? undefined : (visible.expandState === 'expanded' ? 'Collapse' : 'Expand')}
					className={positronClassNames(
						'positron-tree-twisty',
						`positron-tree-twisty-${visible.expandState}`
					)}
					disabled={twistyDisabled}
					tabIndex={-1}
					title={errorMessage}
					type='button'
					onClick={onTwistyClick}
				>
					{renderTwistyGlyph(twistyGlyphState)}
				</button>
				<div className='positron-tree-content'>
					{this._renderNode(visible, { index: rowIndex, cursor, treeFocused, selected })}
				</div>
			</div>
		);
	}

	//#endregion DataGridInstance Implementation
}

/**
 * Stringifies an error captured by _fetchChildren for use as the twisty's tooltip. Falls back
 * to String(err) when the value isn't an Error instance (some rejected promises carry plain
 * strings or objects).
 */
function formatError(err: unknown): string {
	if (err === undefined) {
		return '';
	}
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}

/**
 * Renders the twisty / status glyph for a row, based on its expand state. Codicon classes
 * align with the icons used elsewhere in Positron; CSS sets the size and color explicitly on
 * the glyph element (codicons don't reliably inherit color from ancestor rules).
 */
function renderTwistyGlyph(state: VisibleNode<unknown>['expandState']): ReactNode {
	switch (state) {
		case 'leaf':
			return null;
		case 'collapsed':
			return <div className='codicon codicon-chevron-right positron-tree-twisty-glyph' />;
		case 'expanded':
			return <div className='codicon codicon-chevron-down positron-tree-twisty-glyph' />;
		case 'loading':
			return <div className='codicon codicon-loading codicon-modifier-spin positron-tree-twisty-glyph' />;
		case 'error':
			return <div className='codicon codicon-error positron-tree-twisty-glyph positron-tree-twisty-glyph-error' />;
	}
}
