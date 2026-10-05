/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { ReactNode } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { PositronActionBarHoverManager } from '../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { TreeNode, TreeNodeContext, VisibleNode } from '../../positronTree/classes/treeNode.js';
import { PositronTreeInstance } from '../../positronTree/classes/positronTreeInstance.js';
import { MouseSelectionType } from '../../positronDataGrid/classes/dataGridInstance.js';
import { AnchorPoint } from '../../positronComponents/positronModalPopup/positronModalPopup.js';
import { CustomContextMenuItem } from '../../positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuSeparator } from '../../positronComponents/customContextMenu/customContextMenuSeparator.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../positronComponents/customContextMenu/customContextMenu.js';
import { ObjectNode, SearchResult, SearchRow, SearchRowMatchKind } from '../../../services/positronObjectExplorer/common/objectExplorerBackend.js';
import { ObjectExplorerClientInstance } from '../../../services/languageRuntime/common/languageRuntimeObjectExplorerClient.js';
import { ObjectExplorerMoreRow, ObjectExplorerRow } from '../components/objectExplorerRow.js';

/**
 * The height of a row, in pixels.
 */
export const OBJECT_EXPLORER_ROW_HEIGHT = 24;

/**
 * The number of children fetched per page.
 */
export const CHILDREN_PAGE_SIZE = 1000;

/**
 * The per-level indent, in pixels.
 */
const INDENT_WIDTH = 16;

/**
 * The width of the tree's twisty: a 16px button with a 3px gutter (see positronTreeInstance.css).
 */
export const TWISTY_WIDTH = 19;

/**
 * The narrowest a Name cell gets at depth before the columns stop lining up.
 */
const MINIMUM_NAME_CELL_WIDTH = 40;

/**
 * The data behind a row: a node of the explored object, or a row standing in for the children of
 * a node that have not been loaded yet.
 */
export type ObjectNodeData =
	| { readonly type: 'node'; readonly path: readonly string[]; readonly node: ObjectNode; readonly match?: SearchRowMatchKind }
	| { readonly type: 'more'; readonly parentPath: readonly string[]; readonly nextStart: number; readonly total: number };

/**
 * Gets the tree node id for a path. Paths are stable across refreshes, so expansion survives them.
 */
export function objectNodeId(path: readonly string[]): string {
	return JSON.stringify(path);
}

/**
 * The results of a search, shown as a tree of the matches and their ancestors.
 */
export interface ObjectExplorerSearchResults {
	readonly query: string;
	readonly root: ObjectNode;
	readonly result: SearchResult;
}

/**
 * The column widths shared by the column headers and every tree showing the explored object.
 */
export class ObjectExplorerColumnWidths extends Disposable {
	static readonly MINIMUM_WIDTH = 80;

	private _name = 280;
	private _type = 160;

	private readonly _onDidChangeEmitter = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChangeEmitter.event;

	/**
	 * The width of the Name column, including the tree's indent and twisty.
	 */
	get name(): number {
		return this._name;
	}

	/**
	 * The width of the Type column.
	 */
	get type(): number {
		return this._type;
	}

	set(name: number, type: number): void {
		name = Math.max(ObjectExplorerColumnWidths.MINIMUM_WIDTH, name);
		type = Math.max(ObjectExplorerColumnWidths.MINIMUM_WIDTH, type);
		if (name !== this._name || type !== this._type) {
			this._name = name;
			this._type = type;
			this._onDidChangeEmitter.fire();
		}
	}
}

/**
 * ObjectExplorerTreeInstance class. The tree of an explored object, fetched one level and one
 * page at a time from the object explorer client; or, for a search, the tree of its results.
 */
export class ObjectExplorerTreeInstance extends PositronTreeInstance<ObjectNodeData> {
	// Shared by every row so a row unmounting doesn't dispose a manager.
	private readonly _hoverManager: PositronActionBarHoverManager;

	// The ids of the "more" rows whose next page is being fetched.
	private readonly _loadingMore = new Set<string>();

	// How many children of each node the user has loaded, keyed by node id, so a reload brings
	// back as many as were on screen.
	private readonly _loadedChildCounts = new Map<string, number>();

	// For a search, the results under each matching node's ancestors, keyed by the ancestor's id,
	// in pre-order.
	private readonly _searchChildren = new Map<string, TreeNode<ObjectNodeData>[]>();

	/**
	 * Constructor.
	 * @param _client The object explorer client.
	 * @param _columnWidths The column widths.
	 * @param _maxDepth Returns the maximum depth a node can be expanded at.
	 * @param _search The search results to show, or undefined to show the explored object.
	 */
	constructor(
		private readonly _client: ObjectExplorerClientInstance,
		private readonly _columnWidths: ObjectExplorerColumnWidths,
		private readonly _maxDepth: () => number,
		private readonly _search: ObjectExplorerSearchResults | undefined,
		private readonly _clipboardService: IClipboardService,
		private readonly _notificationService: INotificationService,
		hoverService: IHoverService,
		configurationService: IConfigurationService,
	) {
		super({
			rowHeight: OBJECT_EXPLORER_ROW_HEIGHT,
			indentWidth: INDENT_WIDTH,
			selectionFollowsCursor: true,
			stickyScroll: true,
			// Called from the base constructor, so this reaches its state through the parameters.
			getRoots: async () => [_search ?
				{ ...toTreeNode([], _search.root, _maxDepth()), hasChildren: _search.result.rows.length > 0 } :
				toTreeNode([], await _client.getRoot(), _maxDepth())],
			getChildren: async node => this._search ? this._searchChildren.get(node.id) ?? [] : this._fetchNodeChildren(node),
			renderNode: (visible, context) => this._renderRow(visible, context),
		});

		this._hoverManager = this._register(new PositronActionBarHoverManager(true, configurationService, hoverService));

		this._register(this._columnWidths.onDidChange(() => this.fireOnDidUpdateEvent()));

		if (this._search) {
			groupSearchRows(this._search.result.rows, this._searchChildren);
		}

		// Expand the root the first time it arrives, and for a search, every ancestor of a match,
		// parents before children. Later reloads preserve the expansion.
		const rootLoaded = this._register(this.onDidChangeLoading(() => {
			if (this.initialLoadCompleted && this.visibleNodes.length > 0) {
				rootLoaded.dispose();
				const ids = this._search ? [...this._searchChildren.keys()] : [this.visibleNodes[0].node.id];
				void (async () => {
					for (const id of ids) {
						await this.expand(id);
					}
				})();
			}
		}));
	}

	//#region Public Methods

	/**
	 * Copies the full value of the node at a row to the clipboard.
	 * @param rowIndex The row index.
	 */
	async copyValue(rowIndex: number): Promise<void> {
		const data = this.visibleNodes[rowIndex]?.node.data;
		if (data?.type !== 'node') {
			return;
		}
		try {
			const text = await this._client.formatValue([...data.path]);
			await this._clipboardService.writeText(text);
		} catch (err) {
			this._notificationService.error(localize(
				'positron.objectExplorer.copyValueFailed',
				"Could not copy the value: {0}",
				errorMessage(err)
			));
		}
	}

	/**
	 * Copies the accessor of the node at a row to the clipboard.
	 * @param rowIndex The row index.
	 */
	async copyAccessor(rowIndex: number): Promise<void> {
		const accessor = this.accessorAt(rowIndex);
		if (accessor !== undefined) {
			await this._clipboardService.writeText(accessor);
		}
	}

	/**
	 * Gets the accessor of the node at a row, if it has one.
	 * @param rowIndex The row index.
	 */
	accessorAt(rowIndex: number): string | undefined {
		const data = this.visibleNodes[rowIndex]?.node.data;
		return data?.type === 'node' ? data.node.accessor : undefined;
	}

	/**
	 * Copies the value at the cursor. Called by the data grid for Cmd/Ctrl+C.
	 */
	async copyToClipboard(): Promise<void> {
		await this.copyValue(this.cursorRowIndex);
	}

	//#endregion Public Methods

	//#region DataGridInstance Overrides

	override get hoverManager(): PositronActionBarHoverManager {
		return this._hoverManager;
	}

	/**
	 * Enter toggles the cursor row, or loads the next page on a "more" row.
	 */
	override async onEnterKey(): Promise<void> {
		await this._activate(this.cursorRowIndex);
	}

	/**
	 * Space toggles the cursor row, or loads the next page on a "more" row.
	 */
	override async onSpaceKey(): Promise<void> {
		await this._activate(this.cursorRowIndex);
	}

	/**
	 * Right loads the next page on a "more" row; otherwise it expands or moves to the first child.
	 */
	override moveCursorRight(): void {
		if (this.visibleNodes[this.cursorRowIndex]?.node.data.type === 'more') {
			void this._loadMore(this.cursorRowIndex);
		} else {
			super.moveCursorRight();
		}
	}

	/**
	 * Clicking a "more" row loads the next page.
	 */
	override async mouseSelectCell(columnIndex: number, rowIndex: number, pinned: boolean, mouseSelectionType: MouseSelectionType): Promise<void> {
		await super.mouseSelectCell(columnIndex, rowIndex, pinned, mouseSelectionType);
		if (this.visibleNodes[rowIndex]?.node.data.type === 'more') {
			await this._loadMore(rowIndex);
		}
	}

	/**
	 * PageUp moves the cursor up by one page.
	 */
	override async scrollPageUp(): Promise<void> {
		await this._moveCursorByPage(-1);
	}

	/**
	 * PageDown moves the cursor down by one page.
	 */
	override async scrollPageDown(): Promise<void> {
		await this._moveCursorByPage(1);
	}

	/**
	 * Shows the context menu for a row. With no anchor point, the menu is anchored to the row.
	 */
	override async showCellContextMenu(
		columnIndex: number,
		rowIndex: number,
		anchorElement: HTMLElement,
		anchorPoint?: AnchorPoint
	): Promise<void> {
		await this.mouseSelectRow(rowIndex, MouseSelectionType.Single);
		const visible = this.visibleNodes[rowIndex];
		if (visible?.node.data.type !== 'node') {
			return;
		}

		const id = visible.node.id;
		const entries: CustomContextMenuEntry[] = [
			new CustomContextMenuItem({
				icon: 'copy',
				label: localize('positron.objectExplorer.copyValue', "Copy Value"),
				onSelected: () => this.copyValue(rowIndex)
			}),
			new CustomContextMenuItem({
				label: localize('positron.objectExplorer.copyAccessor', "Copy Accessor"),
				disabled: visible.node.data.node.accessor === undefined,
				onSelected: () => this.copyAccessor(rowIndex)
			}),
			new CustomContextMenuSeparator(),
			visible.expandState === 'expanded' ?
				new CustomContextMenuItem({
					label: localize('positron.objectExplorer.collapse', "Collapse"),
					onSelected: () => this.collapse(id)
				}) :
				new CustomContextMenuItem({
					label: localize('positron.objectExplorer.expand', "Expand"),
					disabled: visible.expandState !== 'collapsed',
					onSelected: () => this.expand(id)
				}),
		];

		// Keep the row painted as focused while the menu holds DOM focus.
		const hold = this.holdFocusAppearance();
		showCustomContextMenu({
			anchorElement,
			anchorPoint: anchorPoint ?? this._rowAnchorPoint(anchorElement, rowIndex),
			popupPosition: 'auto',
			popupAlignment: 'auto',
			width: 220,
			entries,
			onClose: () => hold.dispose()
		});
	}

	//#endregion DataGridInstance Overrides

	//#region Private Methods

	/**
	 * Fetches the children of a node, as many pages as were loaded before.
	 */
	private async _fetchNodeChildren(node: TreeNode<ObjectNodeData>): Promise<readonly TreeNode<ObjectNodeData>[]> {
		if (node.data.type !== 'node') {
			return [];
		}

		const path = [...node.data.path];
		const wanted = this._loadedChildCounts.get(node.id) ?? CHILDREN_PAGE_SIZE;
		const children: TreeNode<ObjectNodeData>[] = [];
		let total = 0;
		do {
			const page = await this._client.getChildren(path, children.length, CHILDREN_PAGE_SIZE);
			total = page.total;
			children.push(...page.children.map(child => toTreeNode([...path, child.access_key], child, this._maxDepth())));
			if (page.children.length === 0) {
				break;
			}
		} while (children.length < wanted && children.length < total);

		return withMoreRow(path, children, total);
	}

	/**
	 * Fetches the next page of children for the "more" row at a row index and appends it.
	 */
	private async _loadMore(rowIndex: number): Promise<void> {
		const visible = this.visibleNodes[rowIndex];
		if (visible?.node.data.type !== 'more' || this._loadingMore.has(visible.node.id)) {
			return;
		}

		const { parentPath, nextStart } = visible.node.data;
		const moreId = visible.node.id;
		const parentId = objectNodeId(parentPath);
		this._loadingMore.add(moreId);
		this.fireOnDidUpdateEvent();
		try {
			const page = await this._client.getChildren([...parentPath], nextStart, CHILDREN_PAGE_SIZE);

			// The parent may have been reloaded while the page was in flight; only append to the
			// children the page continues.
			const existing = this.getLoadedChildren(parentId);
			const last = existing?.[existing.length - 1];
			if (last?.id !== moreId || last.data.type !== 'more' || last.data.nextStart !== nextStart) {
				return;
			}

			const loaded = [
				...existing!.slice(0, -1),
				...page.children.map(child => toTreeNode([...parentPath, child.access_key], child, this._maxDepth()))
			];
			this._loadedChildCounts.set(parentId, loaded.length);
			this.setChildren(parentId, withMoreRow(parentPath, loaded, page.total));
		} catch (err) {
			this._notificationService.error(localize(
				'positron.objectExplorer.loadMoreFailed',
				"Could not load more values: {0}",
				errorMessage(err)
			));
		} finally {
			this._loadingMore.delete(moreId);
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Toggles the row at an index, or loads the next page if it is a "more" row.
	 */
	private async _activate(rowIndex: number): Promise<void> {
		const visible = this.visibleNodes[rowIndex];
		if (visible === undefined) {
			return;
		}
		if (visible.node.data.type === 'more') {
			await this._loadMore(rowIndex);
		} else if (visible.expandState === 'expanded' || visible.expandState === 'collapsed' || visible.expandState === 'error') {
			await this.toggle(visible.node.id);
		}
	}

	/**
	 * Moves the cursor (and the selection that follows it) by one viewport of rows.
	 * @param direction -1 for up, 1 for down.
	 */
	private async _moveCursorByPage(direction: -1 | 1): Promise<void> {
		if (this.rows === 0) {
			return;
		}

		// The cursor moves synchronously, before the scroll is awaited, so the data grid's own
		// selection handling sees the new cursor row.
		const pageRows = Math.max(1, Math.floor(this.layoutHeight / OBJECT_EXPLORER_ROW_HEIGHT));
		const rowIndex = Math.min(this.rows - 1, Math.max(0, this.cursorRowIndex + direction * pageRows));
		this.setCursorRow(rowIndex);
		this.selectRow(rowIndex);
		await this.scrollToCursor();
	}

	/**
	 * Gets the point to anchor a row's context menu at when it was not opened by the mouse.
	 */
	private _rowAnchorPoint(anchorElement: HTMLElement, rowIndex: number): AnchorPoint {
		const rect = anchorElement.getBoundingClientRect();
		const visible = this.visibleNodes[rowIndex];
		const rowTop = rowIndex * OBJECT_EXPLORER_ROW_HEIGHT - this.verticalScrollOffset;
		return {
			clientX: rect.left + (visible?.indentLevel ?? 0) * this.indentWidth + TWISTY_WIDTH + 8,
			clientY: rect.top + rowTop + OBJECT_EXPLORER_ROW_HEIGHT
		};
	}

	/**
	 * Renders a row's cells.
	 */
	private _renderRow(visible: VisibleNode<ObjectNodeData>, _context: TreeNodeContext): ReactNode {
		const nameWidth = Math.max(
			MINIMUM_NAME_CELL_WIDTH,
			this._columnWidths.name - visible.indentLevel * this.indentWidth - TWISTY_WIDTH
		);
		const typeWidth = this._columnWidths.type;
		const data = visible.node.data;

		if (data.type === 'more') {
			return (
				<ObjectExplorerMoreRow
					loading={this._loadingMore.has(visible.node.id)}
					nameWidth={nameWidth}
					pageSize={CHILDREN_PAGE_SIZE}
					remaining={data.total - data.nextStart}
					typeWidth={typeWidth}
				/>
			);
		}

		return (
			<ObjectExplorerRow
				hoverManager={this._hoverManager}
				match={data.match}
				maxDepthReached={!this._search && isExpandable(data.node) && data.path.length >= this._maxDepth()}
				nameWidth={nameWidth}
				node={data.node}
				query={this._search?.query}
				typeWidth={typeWidth}
			/>
		);
	}

	//#endregion Private Methods
}

/**
 * Whether the backend can list children for a node.
 */
function isExpandable(node: ObjectNode): boolean {
	return node.has_children && !node.is_cycle;
}

/**
 * Builds the tree node for a node of the explored object.
 * @param path The access keys from the root to the node.
 * @param node The node.
 * @param maxDepth The maximum depth a node can be expanded at.
 */
function toTreeNode(path: readonly string[], node: ObjectNode, maxDepth: number): TreeNode<ObjectNodeData> {
	return {
		id: objectNodeId(path),
		data: { type: 'node', path, node },
		hasChildren: isExpandable(node) && path.length < maxDepth
	};
}

/**
 * Groups search rows under their parents' ids, in pre-order. A row is expandable when it is the
 * parent of another row.
 * @param rows The search rows: matches and their ancestors, in pre-order.
 * @param groups Receives the children of each parent.
 */
function groupSearchRows(rows: readonly SearchRow[], groups: Map<string, TreeNode<ObjectNodeData>[]>): void {
	const parentIds = new Set(rows.map(row => objectNodeId(row.path.slice(0, -1))));
	for (const row of rows) {
		const parentId = objectNodeId(row.path.slice(0, -1));
		const id = objectNodeId(row.path);
		const children = groups.get(parentId) ?? [];
		children.push({
			id,
			data: { type: 'node', path: row.path, node: row.node, match: row.match_kind },
			hasChildren: parentIds.has(id)
		});
		groups.set(parentId, children);
	}
}

/**
 * Appends a "more" row to a page of children when the parent has more than were loaded.
 */
function withMoreRow(parentPath: readonly string[], children: TreeNode<ObjectNodeData>[], total: number): TreeNode<ObjectNodeData>[] {
	if (children.length >= total) {
		return children;
	}
	return [...children, {
		id: `more:${objectNodeId(parentPath)}`,
		data: { type: 'more', parentPath, nextStart: children.length, total },
		hasChildren: false
	}];
}

/**
 * Gets the message of an error, which may be an Error or a JSON-RPC error object.
 */
function errorMessage(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
		return err.message;
	}
	return String(err);
}
