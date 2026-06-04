/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronTreeInstance.css';

// React.
import { JSX, ReactNode, MouseEvent as ReactMouseEvent } from 'react';

// Other dependencies.
import { Emitter, Event } from '../../../../base/common/event.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { DataGridInstance, MouseSelectionType, RowSelectionState, SelectionCursorOptions, selectionCursorOptions } from '../../positronDataGrid/classes/dataGridInstance.js';
import { TreeNode, TreeNodeContext, VisibleNode } from './treeNode.js';
import { buildVisibleNodes, findParentIndex } from './treeProjection.js';

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

	// Row height in pixels.
	readonly rowHeight: number;

	// Per-level indent width in pixels. Defaults to 12.
	readonly indentWidth?: number;

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

// Per-level indent width in pixels, used when options.indentWidth is not supplied.
const DEFAULT_INDENT_WIDTH = 12;

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

	// Per-level indent width in pixels and whether to apply default focus/selection styling.
	private readonly _indentWidth: number;
	private readonly _useDefaultStyling: boolean;

	// Structural tree state.
	private _roots: readonly TreeNode<T>[] = [];
	private readonly _children = new Map<string, readonly TreeNode<T>[]>();
	private readonly _expanded = new Set<string>();
	private readonly _loading = new Set<string>();
	private readonly _errors = new Map<string, unknown>();

	// Pending fetch promises keyed by node id. Re-entrant expand() / invalidate() calls return
	// the in-flight promise rather than starting a second fetch.
	private readonly _pendingChildrenFetches = new Map<string, Promise<void>>();

	// Pending roots fetch. Same idea for getRoots / refresh.
	private _pendingRootsFetch: Promise<void> | undefined;

	// The current flat projection. Rebuilt whenever structural state changes.
	private _visibleNodes: readonly VisibleNode<T>[] = [];

	// Whether the initial roots load has completed at least once. Lets consumers distinguish
	// "loading initial data" from "no roots."
	private _initialLoadCompleted = false;

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
		this._indentWidth = options.indentWidth ?? DEFAULT_INDENT_WIDTH;
		this._useDefaultStyling = options.useDefaultStyling ?? true;

		// Lock the column count to one.
		this._columnLayoutManager.setEntries(1);

		// Kick off the initial roots load. Fire-and-forget; the projection rebuilds and the grid
		// repaints when the promise resolves.
		void this.refresh();
	}

	//#endregion Constructor

	//#region Public Properties

	get initialLoadCompleted(): boolean {
		return this._initialLoadCompleted;
	}

	get isLoadingRoots(): boolean {
		return this._pendingRootsFetch !== undefined;
	}

	get visibleNodes(): readonly VisibleNode<T>[] {
		return this._visibleNodes;
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

	setRenderNode(renderNode: PositronTreeRenderNode<T>): void {
		this._renderNode = renderNode;
		this.fireOnDidUpdateEvent();
	}

	//#endregion Public Methods - Renderer Update

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

		const twistyClickable = visible.expandState !== 'leaf' && visible.expandState !== 'loading';
		const errorMessage = visible.expandState === 'error' ? formatError(this._errors.get(visible.node.id)) : undefined;

		return (
			<div
				className={positronClassNames(
					'positron-tree-row',
					{ 'focused': this._useDefaultStyling && cursor && treeFocused },
					{ 'selected': this._useDefaultStyling && selected }
				)}
			>
				<div
					className='positron-tree-indent'
					style={{ width: visible.depth * this._indentWidth }}
				/>
				<button
					aria-label={twistyClickable ? (visible.expandState === 'expanded' ? 'Collapse' : 'Expand') : undefined}
					className={positronClassNames(
						'positron-tree-twisty',
						`positron-tree-twisty-${visible.expandState}`
					)}
					disabled={!twistyClickable}
					tabIndex={-1}
					title={errorMessage}
					type='button'
					onClick={twistyClickable ? onTwistyClick : undefined}
				>
					{renderTwistyGlyph(visible.expandState)}
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
