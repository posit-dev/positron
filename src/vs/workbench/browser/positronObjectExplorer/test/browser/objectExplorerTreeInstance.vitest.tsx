/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// Testing libraries.
import { screen, waitFor } from '@testing-library/react';

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
import { PositronTree } from '../../../positronTree/positronTree.js';
import { ObjectExplorerClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeObjectExplorerClient.js';
import { JsonObjectExplorerBackend } from '../../../../services/positronObjectExplorer/common/jsonObjectExplorerBackend.js';
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
		const search = query === undefined ? undefined :
			{ query, root: await backend.getRoot(), result: await backend.search(query, maxDepth, 1000) };
		const tree = store.add(new ObjectExplorerTreeInstance(
			client,
			columnWidths,
			() => maxDepth,
			search,
			clipboardService,
			notificationService,
			ctx.get(IHoverService),
			ctx.get(IConfigurationService)
		));
		await tree.setSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		await waitFor(() => expect(tree.isExpanded(objectNodeId([]))).toBe(true));
		await waitFor(() => expect(tree.isLoading(objectNodeId([]))).toBe(false));
		return { tree, backend, clipboardService, notificationService };
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

	it('offers Copy Value, Copy Accessor, and Expand in the context menu', async () => {
		const { tree } = await createTree({ a: { b: 1 } });

		await tree.showCellContextMenu(0, 1, document.body, { clientX: 0, clientY: 0 });

		const { entries, onClose } = mockShowCustomContextMenu.mock.calls[0][0];
		onClose();
		expect(entries.map((entry: { options?: { label: string; disabled?: boolean } }) => entry.options && [entry.options.label, !!entry.options.disabled])).toEqual([
			['Copy Value', false],
			['Copy Accessor', false],
			undefined,
			['Expand', false],
		]);
		expect(tree.getSelectedNode()?.id).toBe(objectNodeId(['a']));
	});

	it('shows search results with their ancestors expanded and the matches highlighted', async () => {
		const { tree } = await createTree({ alpha: { beta: ['needle', 'hay'] }, needles: 1 }, 10, 'needle');
		rtl.render(<PositronTree instance={tree} />);

		await waitFor(() => expect(rowNames(tree)).toEqual(['data', 'alpha', 'beta', '[0]', 'needles']));
		const matches = await screen.findAllByTestId('object-explorer-match');
		expect(matches.map(match => match.textContent)).toEqual(['needle', 'needle']);
	});
});

