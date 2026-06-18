/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


// Testing libraries.
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

// Other dependencies.
import { isMacintosh } from '../../../../../base/common/platform.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronTree } from '../../positronTree.js';
import { TreeNode } from '../../classes/treeNode.js';
import { PositronTreeInstance } from '../../classes/positronTreeInstance.js';

// Mirror the gallery harness's row height so virtualization math is concrete.
const ROW_HEIGHT = 22;

// A layout size that produces a scrollable viewport: short enough that 10 rows overflow it.
const VIEWPORT_WIDTH = 300;
const VIEWPORT_HEIGHT = 44;

interface DemoNode {
	readonly label: string;
}

/** A node with no children -- a leaf row. */
function leaf(id: string): TreeNode<DemoNode> {
	return { id, data: { label: id }, hasChildren: false };
}

/** A node that advertises children (so it can be expanded). */
function branch(id: string): TreeNode<DemoNode> {
	return { id, data: { label: id }, hasChildren: true };
}

/**
 * The "jump to top / jump to bottom" chord. The data grid binds it to Cmd on macOS and Ctrl
 * elsewhere (on macOS, Ctrl+Home/End is a deliberate no-op), so the test picks the modifier
 * that actually fires on the host it runs on. See dataGridWaffle.tsx's Home/End handlers.
 */
function jumpChord(key: 'Home' | 'End'): string {
	return isMacintosh ? `{Meta>}{${key}}{/Meta}` : `{Control>}{${key}}{/Control}`;
}

/**
 * Neutralizes the data grid's DOM-driven sizing for tests that assert on instance state (not
 * rendered rows): happy-dom produces no real layout, so the size is driven explicitly with
 * instance.setSize instead. Pair with vi.unstubAllGlobals() in afterEach.
 */
function stubGridLayout() {
	vi.stubGlobal('requestAnimationFrame', () => 0);
	vi.stubGlobal('ResizeObserver', class {
		observe() { }
		unobserve() { }
		disconnect() { }
	});
}

/**
 * Like stubGridLayout, but for tests that assert on rendered rows: the data grid only paints the
 * rows that fit its *local* height, which it learns from the DOM. This gives elements a real
 * offset size and hands it to the grid synchronously via a ResizeObserver that fires on observe().
 * Returns a restore function for the offset overrides; callers must also call vi.unstubAllGlobals().
 */
function stubGridLayoutWithSize(width: number, height: number): () => void {
	const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
	const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
	Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => width });
	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height });

	vi.stubGlobal('requestAnimationFrame', () => 0);
	vi.stubGlobal('ResizeObserver', class {
		private readonly _callback: ResizeObserverCallback;
		constructor(callback: ResizeObserverCallback) { this._callback = callback; }
		observe() {
			// Minimal entry: the grid only reads contentRect's width/height.
			const entry = { contentRect: { width, height } };
			this._callback([entry] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
		}
		unobserve() { }
		disconnect() { }
	});

	return () => {
		Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor!);
		Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor!);
	};
}

// A viewport tall enough to render a handful of rows at once, for the rendering assertions.
const TALL_VIEWPORT_HEIGHT = 400;

/**
 * A promise whose resolution is controlled by the test, for driving async fetch states (loading,
 * error) deterministically rather than racing real timers.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

describe('PositronTreeInstance', () => {
	createTestContainer().build();

	let store: DisposableStore;
	beforeEach(() => { store = new DisposableStore(); });
	afterEach(() => store.dispose());

	/**
	 * Builds a tree whose roots all advertise children, each yielding `childrenPerNode` leaves.
	 * Awaits the initial roots load so the instance is ready to assert against.
	 */
	async function newTree(rootCount: number, childrenPerNode: number) {
		const instance = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			getRoots: async () => Array.from({ length: rootCount }, (_, i) => branch(`r${i}`)),
			getChildren: async node => Array.from(
				{ length: childrenPerNode },
				(_, i) => leaf(`${node.id}.${i}`)
			),
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(instance);
		// The constructor kicks off the initial load; awaiting refresh() joins that in-flight fetch.
		await instance.refresh();
		return instance;
	}

	it('loads roots and reports them as collapsed rows', async () => {
		const tree = await newTree(3, 2);

		expect({
			rows: tree.rows,
			initialLoadCompleted: tree.initialLoadCompleted,
			firstExpanded: tree.isExpanded('r0'),
		}).toMatchInlineSnapshot(`
			{
			  "firstExpanded": false,
			  "initialLoadCompleted": true,
			  "rows": 3,
			}
		`);
	});

	it('expands a node to reveal its children and collapses it back', async () => {
		const tree = await newTree(3, 2);

		await tree.expand('r0');
		const expandedRows = tree.rows; // 3 roots + 2 children

		tree.collapse('r0');

		expect({ expandedRows, collapsedRows: tree.rows }).toEqual({
			expandedRows: 5,
			collapsedRows: 3,
		});
	});

	it('moveCursorRight expands the focused node, then moveCursorLeft collapses it', async () => {
		const tree = await newTree(3, 2);
		// Cursor starts on the first root (r0).

		// Right on a collapsed node expands it (fire-and-forget fetch); wait for the children.
		tree.moveCursorRight();
		await waitFor(() => expect(tree.isExpanded('r0')).toBe(true));
		expect(tree.rows).toBe(5);

		// Left on an expanded node collapses it.
		tree.moveCursorLeft();
		expect(tree.isExpanded('r0')).toBe(false);
		expect(tree.rows).toBe(3);
	});

	it('setChildren pushes loaded children without invoking getChildren', async () => {
		const tree = await newTree(2, 0); // getChildren would yield nothing; push explicitly instead
		tree.setChildren('r0', [leaf('pushed-a'), leaf('pushed-b')]);
		await tree.expand('r0');

		expect({
			rows: tree.rows,
			focusedId: tree.focusedId, // cursor still on r0
		}).toEqual({ rows: 4, focusedId: 'r0' });
	});
});

describe('PositronTree keyboard navigation', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let store: DisposableStore;
	beforeEach(() => {
		store = new DisposableStore();
		stubGridLayout();
	});
	afterEach(() => {
		store.dispose();
		vi.unstubAllGlobals();
	});

	/**
	 * Builds a flat tree of leaf rows, renders it, sizes the viewport, and focuses the grid.
	 * selectionFollowsCursor mirrors the option that collapses the selection onto the cursor after
	 * every navigation move (default false, as in the gallery).
	 */
	async function renderFlatTree(leafCount: number, selectionFollowsCursor = false) {
		const common = {
			rowHeight: ROW_HEIGHT,
			getRoots: async () => Array.from({ length: leafCount }, (_, i) => leaf(`n${i}`)),
			getChildren: async () => [],
			renderNode: (visible: { node: TreeNode<DemoNode> }) => <span>{visible.node.data.label}</span>,
		};
		const instance = selectionFollowsCursor
			? new PositronTreeInstance<DemoNode>({ ...common, selectionFollowsCursor: true })
			: new PositronTreeInstance<DemoNode>({ ...common, selectionFollowsCursor: false });
		store.add(instance);
		await instance.refresh();

		rtl.render(<PositronTree instance={instance} />);
		await instance.setSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		screen.getByRole('grid').focus();

		return instance;
	}

	it('Cmd/Ctrl+End jumps the cursor and viewport to the last row', async () => {
		const user = userEvent.setup();
		const instance = await renderFlatTree(10);

		await user.keyboard(jumpChord('End'));

		await waitFor(() => {
			expect({
				cursor: instance.cursorRowIndex,
				scroll: instance.verticalScrollOffset,
			}).toEqual({
				cursor: instance.lastSelectableRowIndex, // 9
				scroll: instance.maximumVerticalScrollOffset, // 220 - 44 = 176
			});
		});
	});

	it('Cmd/Ctrl+Home returns the cursor and viewport to the first row', async () => {
		const user = userEvent.setup();
		const instance = await renderFlatTree(10);

		await user.keyboard(jumpChord('End'));
		await waitFor(() => expect(instance.cursorRowIndex).toBe(instance.lastSelectableRowIndex));

		await user.keyboard(jumpChord('Home'));

		await waitFor(() => {
			expect({
				cursor: instance.cursorRowIndex,
				scroll: instance.verticalScrollOffset,
			}).toEqual({ cursor: 0, scroll: 0 });
		});
	});

	it('Down/Up arrows move the cursor between visible rows', async () => {
		const user = userEvent.setup();
		const instance = await renderFlatTree(5);
		// Cursor starts on the first row.
		expect(instance.focusedId).toBe('n0');

		await user.keyboard('{ArrowDown}{ArrowDown}');
		await waitFor(() => expect(instance.focusedId).toBe('n2'));

		await user.keyboard('{ArrowUp}');
		await waitFor(() => expect(instance.focusedId).toBe('n1'));
	});

	it('selection follows the cursor when selectionFollowsCursor is set', async () => {
		const user = userEvent.setup();
		const instance = await renderFlatTree(5, true);

		// Cursor starts on the first row with nothing selected; selection tracks on a move.
		expect(instance.getSelectedNode()).toBeUndefined();

		await user.keyboard('{ArrowDown}');
		await waitFor(() => expect(instance.getSelectedNode()?.id).toBe('n1'));
		expect(instance.focusedId).toBe('n1');

		// Single-selection collapses onto the new cursor row, so the prior selection is replaced.
		await user.keyboard('{ArrowDown}');
		await waitFor(() => expect(instance.getSelectedNode()?.id).toBe('n2'));
		expect(instance.focusedId).toBe('n2');
	});

	it('selection does not follow the cursor by default', async () => {
		const user = userEvent.setup();
		const instance = await renderFlatTree(5); // selectionFollowsCursor defaults to false

		await user.keyboard('{ArrowDown}');
		await waitFor(() => expect(instance.focusedId).toBe('n1'));

		// The cursor (focus) moved, but selection is left untouched -- the two stay independent.
		expect(instance.getSelectedNode()).toBeUndefined();
	});
});

describe('PositronTree rendering and loading states', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let store: DisposableStore;
	let restoreLayout: () => void;
	beforeEach(() => {
		store = new DisposableStore();
		// A tall viewport so the small trees in these tests paint all their rows at once.
		restoreLayout = stubGridLayoutWithSize(VIEWPORT_WIDTH, TALL_VIEWPORT_HEIGHT);
	});
	afterEach(() => {
		store.dispose();
		vi.unstubAllGlobals();
		restoreLayout();
	});

	/**
	 * Builds a tree from explicit fetchers and registers it for disposal. Roots/children are
	 * supplied per test so the loading and error paths can be driven with deferred promises.
	 */
	function makeTree(
		getRoots: () => Promise<readonly TreeNode<DemoNode>[]>,
		getChildren: (node: TreeNode<DemoNode>) => Promise<readonly TreeNode<DemoNode>[]>
	): PositronTreeInstance<DemoNode> {
		const instance = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			getRoots,
			getChildren,
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(instance);
		return instance;
	}

	it('renders expand/collapse affordances and reveals children on expand', async () => {
		const instance = makeTree(async () => [branch('r0')], async () => [leaf('r0.0')]);
		await instance.refresh();
		rtl.render(<PositronTree instance={instance} />);

		// A collapsed expandable node exposes an "Expand" affordance and hides its children.
		expect(await screen.findByRole('button', { name: 'Expand' })).toBeInTheDocument();
		expect(screen.queryByText('r0.0')).not.toBeInTheDocument();

		// Expanding swaps the affordance to "Collapse" and reveals the child row.
		await instance.expand('r0');
		expect(await screen.findByRole('button', { name: 'Collapse' })).toBeInTheDocument();
		expect(await screen.findByText('r0.0')).toBeInTheDocument();
	});

	it('marks the focused cursor row when the tree has focus', async () => {
		const instance = makeTree(async () => [leaf('a'), leaf('b')], async () => []);
		await instance.refresh();
		rtl.render(<PositronTree instance={instance} />);

		// Before focus, the cursor row carries no focus ring.
		expect((await screen.findByText('a')).closest('.positron-tree-row')).not.toHaveClass('focused');

		// Focusing the tree applies the focus ring to the cursor row (row 0) but not its neighbor.
		screen.getByRole('grid').focus();
		await waitFor(() =>
			expect(screen.getByText('a').closest('.positron-tree-row')).toHaveClass('focused')
		);
		expect(screen.getByText('b').closest('.positron-tree-row')).not.toHaveClass('focused');
	});

	it('shows the initial-load renderer until the first roots fetch resolves', async () => {
		const roots = deferred<readonly TreeNode<DemoNode>[]>();
		const instance = makeTree(() => roots.promise, async () => []);
		// Render without awaiting the in-flight roots fetch, so the initial-load branch shows.
		rtl.render(<PositronTree instance={instance} loadingRendererForInitialLoad={() => <div>Loading tree</div>} />);
		expect(await screen.findByText('Loading tree')).toBeInTheDocument();

		// Once roots arrive, the populated tree replaces the loading renderer.
		roots.resolve([leaf('n0')]);
		expect(await screen.findByText('n0')).toBeInTheDocument();
	});

	it('shows the empty-state renderer when the initial load yields no roots', async () => {
		const instance = makeTree(async () => [], async () => []);
		await instance.refresh();
		rtl.render(<PositronTree emptyTreeRenderer={() => <div>No nodes</div>} instance={instance} />);

		expect(await screen.findByText('No nodes')).toBeInTheDocument();
	});

	it('shows a loading twisty while children are fetched, then reveals them', async () => {
		const children = deferred<readonly TreeNode<DemoNode>[]>();
		const instance = makeTree(async () => [branch('r0')], () => children.promise);
		await instance.refresh();
		rtl.render(<PositronTree instance={instance} />);
		expect(await screen.findByText('r0')).toBeInTheDocument();

		// Begin expanding; the children fetch is in flight (deferred not yet resolved).
		const expanding = instance.expand('r0');

		await waitFor(() => {
			const row = screen.getByText('r0').closest('.positron-tree-row');
			// eslint-disable-next-line no-restricted-syntax -- the loading twisty has no accessible name; assert its state class
			expect(row?.querySelector('.positron-tree-twisty')).toHaveClass('positron-tree-twisty-loading');
		});
		expect(instance.isLoading('r0')).toBe(true);
		expect(screen.queryByText('r0.0')).not.toBeInTheDocument();

		// Resolving the fetch reveals the children.
		children.resolve([leaf('r0.0')]);
		await expanding;
		expect(await screen.findByText('r0.0')).toBeInTheDocument();
	});

	it('shows a clickable error affordance carrying the failure message when a child fetch fails', async () => {
		// The instance logs the failure via console.error; silence it for a clean test run.
		vi.spyOn(console, 'error').mockImplementation(() => { });
		const children = deferred<readonly TreeNode<DemoNode>[]>();
		const instance = makeTree(async () => [branch('r0')], () => children.promise);
		await instance.refresh();
		rtl.render(<PositronTree instance={instance} />);
		expect(await screen.findByText('r0')).toBeInTheDocument();

		const expanding = instance.expand('r0');
		children.reject(new Error('boom'));
		await expanding;

		// The error affordance stays clickable (to retry) and surfaces the message via its title.
		const twisty = await screen.findByRole('button', { name: 'Expand' });
		expect(twisty).toHaveClass('positron-tree-twisty-error');
		expect(twisty).toHaveAttribute('title', 'boom');
	});
});
