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
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPositronDataExplorerService } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { PositronActionBarHoverManager } from '../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { TreeNode, TreeNodeContext, VisibleNode } from '../../positronTree/classes/treeNode.js';
import { PositronTreeInstance } from '../../positronTree/classes/positronTreeInstance.js';
import { MouseSelectionType, RowSelectionState } from '../../positronDataGrid/classes/dataGridInstance.js';
import { AnchorPoint } from '../../positronComponents/positronModalPopup/positronModalPopup.js';
import { CustomContextMenuItem } from '../../positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuSeparator } from '../../positronComponents/customContextMenu/customContextMenuSeparator.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../positronComponents/customContextMenu/customContextMenu.js';
import { FormattedValue, ObjectNode, ObjectNodeKind, SearchResult, SearchRow, SearchRowMatchKind } from '../../../services/positronObjectExplorer/common/objectExplorerBackend.js';
import { ObjectExplorerClientInstance } from '../../../services/languageRuntime/common/languageRuntimeObjectExplorerClient.js';
import { ObjectExplorerMoreRow, ObjectExplorerRow, ObjectExplorerSearchFooter } from '../components/objectExplorerRow.js';

/**
 * The height of a row, in pixels.
 */
export const OBJECT_EXPLORER_ROW_HEIGHT = 24;

/**
 * The height of the footer following the results of a search, in pixels.
 */
const SEARCH_FOOTER_HEIGHT = 32;

/**
 * The number of children fetched per page.
 */
export const CHILDREN_PAGE_SIZE = 1000;

/**
 * The most characters of a value an expanded row shows.
 */
const MAX_EXPANDED_VALUE_LENGTH = 1024;

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

	// The expanded row, which shows its full value, and its height.
	private _expandedRowId: string | undefined;
	private _expandedRowHeight = OBJECT_EXPLORER_ROW_HEIGHT;

	// The value of the selected leaf, and the node it is (being) fetched for.
	private _expandedValue: { readonly node: ObjectNode; readonly value?: FormattedValue } | undefined;

	// The Data Explorers opened on tables, keyed by node id, so a table opens only once.
	private readonly _tableViewers = new Map<string, Promise<string>>();

	/**
	 * Constructor.
	 * @param _client The object explorer client.
	 * @param _columnWidths The column widths.
	 * @param _maxDepth Returns the maximum depth a node can be expanded at.
	 * @param _search The search results to show, or undefined to show the explored object.
	 * @param _clearSearch Clears the search.
	 * @param _sendToConsole Sends text to the input of the console of the explored object's
	 * session, or undefined when there is no session.
	 */
	constructor(
		private readonly _client: ObjectExplorerClientInstance,
		private readonly _columnWidths: ObjectExplorerColumnWidths,
		private readonly _maxDepth: () => number,
		private readonly _search: ObjectExplorerSearchResults | undefined,
		private readonly _clearSearch: () => void,
		private readonly _sendToConsole: ((text: string) => void) | undefined,
		private readonly _clipboardService: IClipboardService,
		private readonly _notificationService: INotificationService,
		private readonly _editorService: IEditorService,
		private readonly _dataExplorerService: IPositronDataExplorerService,
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

		// Collapse the expanded row once it is no longer the selected cursor row, and fetch the
		// value of a newly selected leaf when it could differ from its display value: a truncated
		// value, or a string, which expands unescaped. A reload replaces the node, so its value is
		// fetched again.
		this._register(this.onDidUpdate(() => {
			const selected = this._selectedLeaf();
			if (this._expandedRowId !== undefined && this._expandedRowId !== selected?.id) {
				this.setNodeHeight(this._expandedRowId, undefined);
				this._expandedRowId = undefined;
			}
			if (selected && this._expandedValue?.node !== selected.data.node &&
				(selected.data.node.is_truncated || selected.data.node.kind === ObjectNodeKind.String)) {
				void this._fetchExpandedValue(selected.data.path, selected.data.node);
			}
		}));

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
			const { content } = await this._client.formatValue([...data.path]);
			await this._clipboardService.writeText(content);
		} catch (err) {
			this._notificationService.error(localize(
				'positron.objectExplorer.copyValueFailed',
				"Could not copy the value: {0}",
				errorMessage(err)
			));
		}
	}

	/**
	 * Opens the full value of the node at a row in an untitled editor.
	 * @param rowIndex The row index.
	 */
	async openValue(rowIndex: number): Promise<void> {
		const data = this.visibleNodes[rowIndex]?.node.data;
		if (data?.type !== 'node') {
			return;
		}
		try {
			const { content } = await this._client.formatValue([...data.path]);
			await this._editorService.openEditor({ resource: undefined, contents: content, options: { pinned: true } });
		} catch (err) {
			this._notificationService.error(localize(
				'positron.objectExplorer.openValueFailed',
				"Could not open the value: {0}",
				errorMessage(err)
			));
		}
	}

	/**
	 * Opens the table at a row in a Data Explorer, or focuses the one already open.
	 * @param rowIndex The row index.
	 */
	async viewTable(rowIndex: number): Promise<void> {
		const visible = this.visibleNodes[rowIndex];
		const data = visible?.node.data;
		if (data?.type !== 'node') {
			return;
		}
		const id = visible.node.id;
		const existing = await this._tableViewers.get(id)?.catch(() => undefined);
		const instance = existing !== undefined ? this._dataExplorerService.getInstance(existing) : undefined;
		if (instance) {
			instance.requestFocus();
			return;
		}
		const viewer = this._client.viewTable([...data.path], data.node.display_name);
		this._tableViewers.set(id, viewer);
		try {
			await viewer;
		} catch (err) {
			this._tableViewers.delete(id);
			this._notificationService.error(localize(
				'positron.objectExplorer.viewTableFailed',
				"Could not open the table: {0}",
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
	 * Sends the accessor of the node at a row to the console input, without running it.
	 * @param rowIndex The row index.
	 */
	sendAccessorToConsole(rowIndex: number): void {
		const accessor = this.accessorAt(rowIndex);
		if (accessor !== undefined) {
			this._sendToConsole?.(accessor);
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

	override get footerHeight(): number {
		return this._search ? SEARCH_FOOTER_HEIGHT : 0;
	}

	override renderFooter(): ReactNode {
		return this._search &&
			<ObjectExplorerSearchFooter
				query={this._search.query}
				totalMatches={this._search.result.total_matches}
				truncated={this._search.result.truncated}
				onClearSearch={this._clearSearch}
			/>;
	}

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
		const node = visible.node.data.node;
		const entries: CustomContextMenuEntry[] = [
			new CustomContextMenuItem({
				icon: 'copy',
				label: localize('positron.objectExplorer.copyValue', "Copy Value"),
				onSelected: () => this.copyValue(rowIndex)
			}),
			new CustomContextMenuItem({
				label: localize('positron.objectExplorer.copyAccessor', "Copy Accessor"),
				disabled: node.accessor === undefined,
				onSelected: () => this.copyAccessor(rowIndex)
			}),
			new CustomContextMenuSeparator(),
			new CustomContextMenuItem({
				icon: 'insert',
				label: localize('positron.objectExplorer.sendAccessorToConsole', "Send Accessor to Console"),
				disabled: !this._sendToConsole || node.accessor === undefined,
				onSelected: () => this.sendAccessorToConsole(rowIndex)
			}),
		];
		if (node.kind === ObjectNodeKind.String) {
			entries.push(new CustomContextMenuItem({
				icon: 'file-text',
				label: localize('positron.objectExplorer.openTextInEditor', "Open Text in Editor"),
				onSelected: () => this.openValue(rowIndex)
			}));
		}
		if (this._canViewTable(node)) {
			entries.push(new CustomContextMenuItem({
				icon: 'table',
				label: localize('positron.objectExplorer.openInDataExplorer', "Open in Data Explorer"),
				onSelected: () => this.viewTable(rowIndex)
			}));
		}
		entries.push(
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
				})
		);

		// Keep the row painted as focused while the menu holds DOM focus.
		const hold = this.holdFocusAppearance();
		showCustomContextMenu({
			anchorElement,
			anchorPoint: anchorPoint ?? this._rowAnchorPoint(anchorElement, rowIndex),
			popupPosition: 'auto',
			popupAlignment: 'auto',
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
		const rowTop = this.rowTop(rowIndex) - this.verticalScrollOffset;
		return {
			clientX: rect.left + (visible?.indentLevel ?? 0) * this.indentWidth + TWISTY_WIDTH + 8,
			clientY: rect.top + rowTop + OBJECT_EXPLORER_ROW_HEIGHT
		};
	}

	/**
	 * Whether a node can be opened in a Data Explorer.
	 */
	private _canViewTable(node: ObjectNode): boolean {
		return node.kind === ObjectNodeKind.Table && this._client.canViewTable;
	}

	/**
	 * Gets the cursor row's node if it is a selected leaf, which is the row that expands.
	 */
	private _selectedLeaf(): { readonly id: string; readonly data: Extract<ObjectNodeData, { type: 'node' }> } | undefined {
		const visible = this.visibleNodes[this.cursorRowIndex];
		const data = visible?.node.data;
		return data?.type === 'node' && !data.node.has_children &&
			this.rowSelectionState(this.cursorRowIndex) !== RowSelectionState.None ?
			{ id: visible.node.id, data } :
			undefined;
	}

	/**
	 * Fetches the value an expanded row shows.
	 */
	private async _fetchExpandedValue(path: readonly string[], node: ObjectNode): Promise<void> {
		this._expandedValue = { node };
		try {
			const value = await this._client.formatValue([...path], MAX_EXPANDED_VALUE_LENGTH);
			if (this._expandedValue?.node === node) {
				this._expandedValue = { node, value };
				this.fireOnDidUpdateEvent();
			}
		} catch {
			// The row keeps showing the display value.
		}
	}

	/**
	 * Sizes the expanded row to its content, and reveals it when it grows.
	 */
	private _setExpandedRowHeight(id: string, height: number): void {
		height = Math.max(OBJECT_EXPLORER_ROW_HEIGHT, height);
		if (id === this._expandedRowId && height === this._expandedRowHeight) {
			return;
		}
		if (this._expandedRowId !== undefined && this._expandedRowId !== id) {
			this.setNodeHeight(this._expandedRowId, undefined);
		}
		const grew = id !== this._expandedRowId || height > this._expandedRowHeight;
		this._expandedRowId = id;
		this._expandedRowHeight = height;
		this.setNodeHeight(id, height > OBJECT_EXPLORER_ROW_HEIGHT ? height : undefined);
		if (grew) {
			void this.scrollToCursor();
		}
	}

	/**
	 * Renders a row's cells.
	 */
	private _renderRow(visible: VisibleNode<ObjectNodeData>, context: TreeNodeContext): ReactNode {
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

		const id = visible.node.id;
		const expanded = id === this._selectedLeaf()?.id;
		return (
			<ObjectExplorerRow
				expanded={expanded}
				expandedValue={expanded && this._expandedValue?.node === data.node ? this._expandedValue.value : undefined}
				hoverManager={this._hoverManager}
				match={data.match}
				maxDepthReached={!this._search && isExpandable(data.node) && data.path.length >= this._maxDepth()}
				nameWidth={nameWidth}
				node={data.node}
				query={this._search?.query}
				typeWidth={typeWidth}
				onDidMeasure={height => this._setExpandedRowHeight(id, height)}
				onDoubleClick={() => this._activate(context.index)}
				onOpenValue={() => this.openValue(context.index)}
				onViewTable={this._canViewTable(data.node) ?
					() => this.viewTable(context.index) :
					undefined}
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
