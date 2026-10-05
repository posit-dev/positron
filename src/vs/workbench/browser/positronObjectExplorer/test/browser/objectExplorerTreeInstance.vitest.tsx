/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// Testing libraries.
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

// Other dependencies.
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubGridLayoutWithSize } from '../../../../../test/vitest/stubGridLayout.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IPositronDataExplorerService } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IPositronDataExplorerInstance } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { PositronTree } from '../../../positronTree/positronTree.js';
import { ObjectExplorerClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeObjectExplorerClient.js';
import { JsonObjectExplorerBackend } from '../../../../services/positronObjectExplorer/common/jsonObjectExplorerBackend.js';
import { ObjectNodeKind } from '../../../../services/positronObjectExplorer/common/objectExplorerBackend.js';
import { ObjectExplorerColumnWidths, ObjectExplorerTreeInstance, objectNodeId } from '../../classes/objectExplorerTreeInstance.js';

const { mockShowCustomContextMenu } = vi.hoisted(() => ({ mockShowCustomContextMenu: vi.fn() }));
vi.mock('../../../positronComponents/customContextMenu/customContextMenu.js', () => ({
	showCustomContextMenu: mockShowCustomContextMenu
}));

const VIEWPORT_WIDTH = 600;
const VIEWPORT_HEIGHT = 240; // Ten 24px rows.

describe('ObjectExplorerTreeInstance', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let store: DisposableStore;
	let restoreLayout: () => void;
	beforeEach(() => {
		store = new DisposableStore();
		restoreLayout = stubGridLayoutWithSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
	});
	afterEach(() => {
		store.dispose();
		vi.unstubAllGlobals();
		restoreLayout();
	});

	/**
	 * Builds a tree over a JSON value and waits for the root to load and expand.
	 */
	async function createTree(value: unknown, maxDepth = 10, query?: string) {
		const backend = new JsonObjectExplorerBackend('json:test', 'data', value);
		const client = store.add(new ObjectExplorerClientInstance(backend));
		const columnWidths = store.add(new ObjectExplorerColumnWidths());
		const clipboardService = stubInterface<IClipboardService>({ writeText: vi.fn(async () => { }) });
		const notificationService = stubInterface<INotificationService>({ error: vi.fn() });
		const editorService = stubInterface<IEditorService>({ openEditor: vi.fn(async () => undefined) });
		const dataExplorerService = stubInterface<IPositronDataExplorerService>({ getInstance: vi.fn(() => undefined) });
		const clearSearch = vi.fn();
		const search = query === undefined ? undefined :
			{ query, root: await backend.getRoot(), result: await backend.search(query, maxDepth, 1000) };
		const tree = store.add(new ObjectExplorerTreeInstance(
			client,
			columnWidths,
			() => maxDepth,
			search,
			clearSearch,
			undefined,
			clipboardService,
			notificationService,
			editorService,
			dataExplorerService,
			ctx.get(IHoverService),
			ctx.get(IConfigurationService)
		));
		await tree.setSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		await waitFor(() => expect(tree.isExpanded(objectNodeId([]))).toBe(true));
		await waitFor(() => expect(tree.isLoading(objectNodeId([]))).toBe(false));
		return { tree, backend, clipboardService, notificationService, editorService, dataExplorerService, clearSearch };
	}

	const rowNames = (tree: ObjectExplorerTreeInstance) => tree.visibleNodes.map(visible =>
		visible.node.data.type === 'node' ? visible.node.data.node.display_name : `more:${visible.node.data.nextStart}`);

	it('expands the root on load and renders three cells per row', async () => {
		const { tree } = await createTree({ a: 1, b: { c: 'x' } });
		rtl.render(<PositronTree instance={tree} />);

		const names = await screen.findAllByTestId('object-explorer-name');
		expect(names.map(cell => cell.textContent)).toEqual(['data', 'a', 'b']);
		expect(screen.getAllByTestId('object-explorer-type').map(cell => cell.textContent)).toEqual(['object [2]', 'number', 'object [1]']);
		expect(screen.getAllByTestId('object-explorer-value').map(cell => cell.textContent)).toEqual(['{a: 1, b: {...}}', '1', '{c: "x"}']);
	});

	it('narrows the Name cell by the indent so the other columns line up', async () => {
		const { tree } = await createTree({ a: 1 });
		rtl.render(<PositronTree instance={tree} />);

		const rows = await screen.findAllByTestId('object-explorer-row');

		// 280 - 19 (twisty) at depth 0, and 16 less again at depth 1.
		expect(rows.map(row => row.style.getPropertyValue('--object-explorer-name-width'))).toEqual(['261px', '245px']);
	});

	it('toggles the cursor row with Enter and Space', async () => {
		const { tree } = await createTree({ a: 1, b: { c: 'x' } });
		tree.setCursorRow(2);

		await tree.onEnterKey();
		expect(rowNames(tree)).toEqual(['data', 'a', 'b', 'c']);

		await tree.onSpaceKey();
		expect(rowNames(tree)).toEqual(['data', 'a', 'b']);
	});

	it('toggles a row with a double click', async () => {
		const { tree } = await createTree({ a: 1, b: { c: 'x' } });
		rtl.render(<PositronTree instance={tree} />);
		const user = userEvent.setup();

		await user.dblClick((await screen.findAllByTestId('object-explorer-row'))[2]);
		await waitFor(() => expect(rowNames(tree)).toEqual(['data', 'a', 'b', 'c']));

		await user.dblClick(screen.getAllByTestId('object-explorer-row')[2]);
		await waitFor(() => expect(rowNames(tree)).toEqual(['data', 'a', 'b']));
	});

	it('pages large nodes, loading the next page from the "more" row', async () => {
		const { tree } = await createTree(Array.from({ length: 2500 }, (_, i) => i));
		expect([tree.rows, rowNames(tree).at(-1)]).toEqual([1002, 'more:1000']);

		tree.setCursorRow(1001);
		tree.moveCursorRight();
		await waitFor(() => expect(tree.rows).toBe(2002));

		// The cursor stays on the first row of the new page, and a reload keeps both pages.
		expect(rowNames(tree)[tree.cursorRowIndex]).toBe('[1000]');
		await tree.reloadAll();
		expect([tree.rows, rowNames(tree).at(-1)]).toEqual([2002, 'more:2000']);
	});

	it('moves the cursor and selection by a page', async () => {
		const { tree } = await createTree(Array.from({ length: 50 }, (_, i) => i));

		await tree.scrollPageDown();

		expect([tree.cursorRowIndex, tree.getSelectedNode()?.id]).toEqual([10, objectNodeId(['9'])]);
	});

	it('copies the full value at the cursor', async () => {
		const { tree, clipboardService } = await createTree({ o: { a: 1 } });
		tree.setCursorRow(1);

		await tree.copyToClipboard();

		expect(clipboardService.writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
	});

	it('expands the selected leaf to show its whole value, line breaks included', async () => {
		const { tree } = await createTree({ a: 'one\ntwo', b: { c: 1 } });
		rtl.render(<PositronTree instance={tree} />);
		const expandedValues = () => screen.queryAllByTestId('object-explorer-row')
			.filter(row => row.classList.contains('expanded'))
			.map(row => within(row).getByTestId('object-explorer-value-text').textContent);

		tree.setCursorRow(1);
		tree.selectRow(1);
		await waitFor(() => expect(expandedValues()).toEqual(['"one\ntwo"']));

		// A parent's value summarizes its children, so it does not expand.
		tree.setCursorRow(2);
		tree.selectRow(2);
		await waitFor(() => expect(expandedValues()).toEqual([]));
		expect(tree.rowTop(2) - tree.rowTop(1)).toBe(24);
	});

	it('cuts a long expanded value and opens the full value in an editor', async () => {
		const value = 'y'.repeat(2000);
		const { tree, editorService } = await createTree({ a: value });
		rtl.render(<PositronTree instance={tree} />);

		tree.setCursorRow(1);
		tree.selectRow(1);
		await waitFor(() => {
			const expanded = screen.getAllByTestId('object-explorer-row').find(row => row.classList.contains('expanded'))!;
			expect(within(expanded).getByTestId('object-explorer-value-text')).toHaveTextContent(/^"y{1024}\u2026$/);
		});
		screen.getByTestId('object-explorer-open-value').click();

		await waitFor(() => expect(editorService.openEditor).toHaveBeenCalledWith(
			{ resource: undefined, contents: value, options: { pinned: true } }
		));
	});

	it('does not let nodes at the maximum depth expand', async () => {
		const { tree } = await createTree({ a: { b: { c: 1 } } }, 1);
		rtl.render(<PositronTree instance={tree} />);

		expect(tree.visibleNodes[1].expandState).toBe('leaf');
		expect(await screen.findByText('a')).toBeInTheDocument();
	});

	it('marks cycles and does not let them expand', async () => {
		const { tree, backend } = await createTree({ self: {} });
		const page = await backend.getChildren([], 0, 10);
		vi.spyOn(backend, 'getChildren').mockResolvedValue({
			children: [{ ...page.children[0], is_cycle: true }],
			total: 1
		});
		await tree.reloadAll();
		rtl.render(<PositronTree instance={tree} />);

		expect(await screen.findByText('(circular reference)')).toBeInTheDocument();
		expect(tree.visibleNodes[1].expandState).toBe('leaf');
	});

	it('opens a table in a Data Explorer once, then focuses it', async () => {
		const { tree, backend, dataExplorerService } = await createTree({ t: {} });
		const page = await backend.getChildren([], 0, 10);
		vi.spyOn(backend, 'getChildren').mockResolvedValue({
			children: [{ ...page.children[0], kind: ObjectNodeKind.Table }],
			total: 1
		});
		const viewTable = vi.fn(async () => 'data-explorer');
		Object.assign(backend, { viewTable });
		await tree.reloadAll();
		rtl.render(<PositronTree instance={tree} />);

		(await screen.findByTestId('object-explorer-view-table')).click();
		await waitFor(() => expect(viewTable).toHaveBeenCalledWith(['t'], 't'));

		const requestFocus = vi.fn();
		vi.mocked(dataExplorerService.getInstance).mockReturnValue(stubInterface<IPositronDataExplorerInstance>({ requestFocus }));
		screen.getByTestId('object-explorer-view-table').click();
		await waitFor(() => expect(requestFocus).toHaveBeenCalled());
		expect(viewTable).toHaveBeenCalledTimes(1);
	});

	it('offers copy, send, and expand actions in the context menu', async () => {
		const { tree } = await createTree({ a: { b: 1 } });

		await tree.showCellContextMenu(0, 1, document.body, { clientX: 0, clientY: 0 });

		const { entries, onClose } = mockShowCustomContextMenu.mock.calls[0][0];
		onClose();
		expect(entries.map((entry: { options?: { label: string; disabled?: boolean } }) => entry.options && [entry.options.label, !!entry.options.disabled])).toEqual([
			['Copy Value', false],
			['Copy Accessor', false],
			undefined,
			['Send Accessor to Console', true],
			undefined,
			['Expand', false],
		]);
		expect(tree.getSelectedNode()?.id).toBe(objectNodeId(['a']));
	});

	it('offers Open Text in Editor in the context menu for text', async () => {
		const { tree } = await createTree({ s: 'text' });

		await tree.showCellContextMenu(0, 1, document.body, { clientX: 0, clientY: 0 });

		const { entries, onClose } = mockShowCustomContextMenu.mock.calls[0][0];
		onClose();
		expect(entries.map((entry: { options?: { label: string } }) => entry.options?.label)).toContain('Open Text in Editor');
	});

	it('shows search results with their ancestors expanded and the matches highlighted', async () => {
		const { tree } = await createTree({ alpha: { beta: ['needle', 'hay'] }, needles: 1 }, 10, 'needle');
		rtl.render(<PositronTree instance={tree} />);

		await waitFor(() => expect(rowNames(tree)).toEqual(['data', 'alpha', 'beta', '[0]', 'needles']));
		const matches = await screen.findAllByTestId('object-explorer-match');
		expect(matches.map(match => match.textContent)).toEqual(['needle', 'needle']);
	});

	it('follows search results with their count and a link that clears the search', async () => {
		const user = userEvent.setup();
		const { tree, clearSearch } = await createTree({ alpha: { beta: ['needle', 'hay'] }, needles: 1 }, 10, 'needle');
		rtl.render(<PositronTree instance={tree} />);

		const footer = await screen.findByTestId('object-explorer-search-footer');
		expect(footer).toHaveTextContent(`2 matches for 'needle' (clear search)`);
		await user.click(within(footer).getByRole('link', { name: '(clear search)' }));
		expect(clearSearch).toHaveBeenCalledOnce();
	});
});

