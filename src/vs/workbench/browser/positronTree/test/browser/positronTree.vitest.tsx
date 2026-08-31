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

// Mirror the gallery harness's row height and indent so virtualization math is concrete.
const ROW_HEIGHT = 22;
const INDENT_WIDTH = 16;

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
			indentWidth: INDENT_WIDTH,
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

	it('reload re-fetches an expanded node and restores the expansion beneath it', async () => {
		// Every branch yields one branch child, so the tree can be opened to any depth.
		const getChildren = vi.fn(async (node: TreeNode<DemoNode>) => [branch(`${node.id}.0`)]);
		const instance = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			indentWidth: INDENT_WIDTH,
			getRoots: async () => [branch('r0')],
			getChildren,
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(instance);
		await instance.refresh();

		// Open three levels: r0 -> r0.0 -> r0.0.0 (which loads r0.0.0.0).
		await instance.expand('r0');
		await instance.expand('r0.0');
		await instance.expand('r0.0.0');
		const callsBeforeReload = getChildren.mock.calls.length;
		const rowsBeforeReload = instance.rows;

		await instance.reload('r0');

		expect({
			callsBeforeReload,
			// Each of the three re-expanded levels was re-fetched.
			callsAfterReload: getChildren.mock.calls.length,
			// The same rows are on screen as before the reload.
			rowsBeforeReload,
			rows: instance.rows,
			expanded: ['r0', 'r0.0', 'r0.0.0'].filter(id => instance.isExpanded(id)),
		}).toMatchInlineSnapshot(`
			{
			  "callsAfterReload": 6,
			  "callsBeforeReload": 3,
			  "expanded": [
			    "r0",
			    "r0.0",
			    "r0.0.0",
			  ],
			  "rows": 4,
			  "rowsBeforeReload": 4,
			}
		`);
	});

	it('reload leaves expansion behind for descendants that no longer exist', async () => {
		// 'gone' disappears on the second fetch of r0; 'stays' survives it.
		let firstFetch = true;
		const instance = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			indentWidth: INDENT_WIDTH,
			getRoots: async () => [branch('r0')],
			getChildren: async node => {
				if (node.id !== 'r0') {
					return [leaf(`${node.id}.child`)];
				}
				const children = firstFetch ? [branch('gone'), branch('stays')] : [branch('stays')];
				firstFetch = false;
				return children;
			},
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(instance);
		await instance.refresh();

		await instance.expand('r0');
		await instance.expand('gone');
		await instance.expand('stays');

		await instance.reload('r0');

		expect({
			goneRestored: instance.isExpanded('gone'),
			staysRestored: instance.isExpanded('stays'),
			rows: instance.rows, // r0 + stays + stays.child
		}).toMatchInlineSnapshot(`
			{
			  "goneRestored": false,
			  "rows": 3,
			  "staysRestored": true,
			}
		`);
	});

	it('reload matches nodes by reload key when ids change on every fetch', async () => {
		// Mimics a source that mints a fresh id per fetch (e.g. a handle from a counter): the id
		// carries a fetch sequence number, while the label identifies the node itself.
		let fetchSequence = 0;
		const instance = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			indentWidth: INDENT_WIDTH,
			getRoots: async () => [branch('r0')],
			getChildren: async node => {
				const id = `child@${fetchSequence++}`;
				return [{ id, data: { label: `${node.data.label}.child` }, hasChildren: true }];
			},
			getReloadKey: node => node.data.label,
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(instance);
		await instance.refresh();

		await instance.expand('r0');
		const childId = instance.visibleNodes[1].node.id;
		await instance.expand(childId);
		const rowsBeforeReload = instance.rows;

		await instance.reload('r0');

		// The re-fetched child has a different id, so only a key-based match can restore it.
		const reloadedChildId = instance.visibleNodes[1].node.id;
		expect({
			childId,
			reloadedChildId,
			rowsBeforeReload,
			rows: instance.rows,
			reloadedChildExpanded: instance.isExpanded(reloadedChildId),
		}).toMatchInlineSnapshot(`
			{
			  "childId": "child@0",
			  "reloadedChildExpanded": true,
			  "reloadedChildId": "child@2",
			  "rows": 3,
			  "rowsBeforeReload": 3,
			}
		`);
	});

	it('reload keeps the stale subtree on screen until the new one is ready', async () => {
		// The reload's fetch is held open so the in-flight state can be observed. Without the
		// staged swap, the rows would empty out here and refill when the fetch lands.
		const pending = deferred<readonly TreeNode<DemoNode>[]>();
		let reloading = false;
		const instance = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			indentWidth: INDENT_WIDTH,
			getRoots: async () => [branch('r0')],
			getChildren: async node => reloading ? pending.promise : [leaf(`${node.id}.0`), leaf(`${node.id}.1`)],
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(instance);
		await instance.refresh();
		await instance.expand('r0');

		reloading = true;
		const reload = instance.reload('r0');
		const inFlight = {
			rows: instance.rows,
			refreshing: instance.isRefreshing('r0'),
			// The row keeps its expanded state -- only the twisty glyph changes.
			expandState: instance.visibleNodes[0].expandState,
		};

		pending.resolve([leaf('r0.0'), leaf('r0.1')]);
		await reload;

		expect({
			inFlight,
			rowsAfter: instance.rows,
			refreshingAfter: instance.isRefreshing('r0'),
		}).toMatchInlineSnapshot(`
			{
			  "inFlight": {
			    "expandState": "expanded",
			    "refreshing": true,
			    "rows": 3,
			  },
			  "refreshingAfter": false,
			  "rowsAfter": 3,
			}
		`);
	});

	it('reload discards its result if the node was collapsed while the fetch was in flight', async () => {
		// Mirrors a consumer whose collapse releases the resources the fetch is using -- Data
		// Connections disconnects and drops the subtree. A late commit would install rows whose
		// handles are already dead, and expand() never re-fetches a node whose children are
		// loaded, so they would be stuck there.
		class DropOnCollapseTree extends PositronTreeInstance<DemoNode> {
			override collapse(id: string): void {
				this.dropLoadedChildren(id);
				super.collapse(id);
			}
		}

		const pending = deferred<readonly TreeNode<DemoNode>[]>();
		let reloading = false;
		const tree = new DropOnCollapseTree({
			rowHeight: ROW_HEIGHT,
			indentWidth: INDENT_WIDTH,
			getRoots: async () => [branch('r0')],
			getChildren: async () => reloading ? pending.promise : [leaf('before')],
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(tree);
		await tree.refresh();
		await tree.expand('r0');

		reloading = true;
		const reload = tree.reload('r0');
		tree.collapse('r0');
		pending.resolve([leaf('after')]);
		await reload;

		expect({
			expanded: tree.isExpanded('r0'),
			// Nothing installed, so the next expand fetches against a live resource.
			loadedChildren: tree.hasLoadedChildren('r0'),
		}).toEqual({ expanded: false, loadedChildren: false });
	});

	it('reload caps how many getChildren calls run at once while restoring', async () => {
		// A root with more expanded children than the concurrency cap, so the restore has to
		// queue rather than fire them all at once.
		const wide = Array.from({ length: 20 }, (_, i) => branch(`child${i}`));
		let inFlight = 0;
		let peakInFlight = 0;
		const tree = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			indentWidth: INDENT_WIDTH,
			getRoots: async () => [branch('r0')],
			getChildren: async node => {
				if (node.id === 'r0') {
					return wide;
				}
				inFlight++;
				peakInFlight = Math.max(peakInFlight, inFlight);
				await new Promise(resolve => setTimeout(resolve, 0));
				inFlight--;
				return [leaf(`${node.id}.leaf`)];
			},
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(tree);
		await tree.refresh();
		await tree.expand('r0');
		for (const child of wide) {
			await tree.expand(child.id);
		}

		peakInFlight = 0;
		await tree.reload('r0');

		expect({
			restored: wide.filter(child => tree.isExpanded(child.id)).length,
			cappedBelowChildCount: peakInFlight < wide.length,
			peakInFlight,
		}).toEqual({ restored: 20, cappedBelowChildCount: true, peakInFlight: 8 });
	});

	it('marks everything under a refreshing node stale, and nothing else', async () => {
		// Two roots, each with a child that has its own child, so the walk has depth and a sibling
		// branch that must stay untouched.
		const pending = deferred<readonly TreeNode<DemoNode>[]>();
		let reloading = false;
		const tree = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			indentWidth: INDENT_WIDTH,
			getRoots: async () => [branch('r0'), branch('r1')],
			getChildren: async node => {
				if (reloading && node.id === 'r0') {
					return pending.promise;
				}
				return node.id.includes('.') ? [leaf(`${node.id}.leaf`)] : [branch(`${node.id}.c`)];
			},
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(tree);
		await tree.refresh();
		await tree.expand('r0');
		await tree.expand('r0.c');
		await tree.expand('r1');
		await tree.expand('r1.c');

		reloading = true;
		const reload = tree.reload('r0');
		const duringRefresh = tree.visibleNodes.map(v => `${v.node.id}${v.stale ? ':stale' : ''}`);

		pending.resolve([branch('r0.c')]);
		await reload;

		expect({
			// r0 is refreshing, not stale: it is the node being replaced into. Its whole subtree is
			// stale. r1's branch is untouched.
			duringRefresh,
			anyStaleAfter: tree.visibleNodes.some(v => v.stale),
		}).toMatchInlineSnapshot(`
			{
			  "anyStaleAfter": false,
			  "duringRefresh": [
			    "r0",
			    "r0.c:stale",
			    "r0.c.leaf:stale",
			    "r1",
			    "r1.c",
			    "r1.c.leaf",
			  ],
			}
		`);
	});

	it('reload drops the stale subtree and records the error when the fetch fails', async () => {
		let shouldFail = false;
		const instance = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			indentWidth: INDENT_WIDTH,
			getRoots: async () => [branch('r0')],
			getChildren: async node => {
				if (shouldFail) {
					throw new Error('connection lost');
				}
				return [leaf(`${node.id}.0`)];
			},
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(instance);
		await instance.refresh();
		await instance.expand('r0');

		shouldFail = true;
		await instance.reload('r0');

		expect({
			rows: instance.rows,
			error: (instance.getError('r0') as Error).message,
			loadedChildren: instance.hasLoadedChildren('r0'),
			refreshing: instance.isRefreshing('r0'),
		}).toMatchInlineSnapshot(`
			{
			  "error": "connection lost",
			  "loadedChildren": false,
			  "refreshing": false,
			  "rows": 1,
			}
		`);
	});

	it('reload marks the rows it brought in as recently refreshed, then clears the mark', async () => {
		vi.useFakeTimers();
		try {
			const tree = await newTree(1, 2);
			await tree.expand('r0');

			await tree.reload('r0');
			// The reloaded node is marked along with the rows brought in beneath it, so the whole
			// refreshed block reads as one.
			const marked = tree.visibleNodes.filter(v => v.recentlyRefreshed).map(v => v.node.id);

			// The highlight is on a timer, so it clears without any further interaction.
			await vi.advanceTimersByTimeAsync(3000);

			expect({
				marked,
				afterTimeout: tree.visibleNodes.filter(v => v.recentlyRefreshed).map(v => v.node.id),
			}).toMatchInlineSnapshot(`
				{
				  "afterTimeout": [],
				  "marked": [
				    "r0",
				    "r0.0",
				    "r0.1",
				  ],
				}
			`);
		} finally {
			vi.useRealTimers();
		}
	});

	it('reload drops a collapsed node\'s children so the next expand re-fetches', async () => {
		const tree = await newTree(1, 2);
		await tree.expand('r0');
		tree.collapse('r0');

		await tree.reload('r0');

		expect(tree.hasLoadedChildren('r0')).toBe(false);
	});

	it('reloadAll re-runs getRoots and reloads every expanded root', async () => {
		const getRoots = vi.fn(async () => [branch('r0'), branch('r1')]);
		const getChildren = vi.fn(async (node: TreeNode<DemoNode>) => [leaf(`${node.id}.0`)]);
		const tree = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			indentWidth: INDENT_WIDTH,
			getRoots,
			getChildren,
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(tree);
		await tree.refresh();

		// Only r0 is opened, so only its subtree is on screen.
		await tree.expand('r0');
		const rootsBefore = getRoots.mock.calls.length;
		const childrenBefore = getChildren.mock.calls.length;

		await tree.reloadAll();

		expect({
			rootsFetches: getRoots.mock.calls.length - rootsBefore,
			// r0's subtree is re-fetched; collapsed r1 has nothing on screen to replace.
			childrenFetches: getChildren.mock.calls.length - childrenBefore,
			stillExpanded: tree.isExpanded('r0'),
			rows: tree.rows,
		}).toEqual({ rootsFetches: 1, childrenFetches: 1, stillExpanded: true, rows: 3 });
	});

	it('a second reload keeps the highlight on rows the first one had already marked', async () => {
		vi.useFakeTimers();
		try {
			// Root ids are stable while child ids carry a per-fetch handle, as in Data Connections.
			// The root is therefore in both reloads' batches, and the first batch's timer must not
			// clear a mark the second reload has taken over.
			let handle = 0;
			const tree = new PositronTreeInstance<DemoNode>({
				rowHeight: ROW_HEIGHT,
				indentWidth: INDENT_WIDTH,
				getRoots: async () => [{ id: 'root', data: { label: 'root' }, hasChildren: true }],
				getChildren: async () => [{ id: `child@${handle++}`, data: { label: 'child' }, hasChildren: false }],
				getReloadKey: node => node.data.label,
				renderNode: visible => <span>{visible.node.data.label}</span>,
			});
			store.add(tree);
			await tree.refresh();
			await tree.expand('root');

			await tree.reload('root');
			const firstGeneration = tree.visibleNodes[0].refreshGeneration;

			// Second reload lands mid-highlight.
			await vi.advanceTimersByTimeAsync(500);
			await tree.reload('root');
			// A fresh generation is what makes the row restart its animation rather than sit out
			// the new highlight.
			const secondGeneration = tree.visibleNodes[0].refreshGeneration;

			// The first reload's timer comes due; it must not clear what the second one re-marked.
			await vi.advanceTimersByTimeAsync(1000);
			const afterFirstTimer = tree.visibleNodes.map(v => v.recentlyRefreshed);

			// The second reload's own timer then clears everything.
			await vi.advanceTimersByTimeAsync(600);

			expect({
				afterFirstTimer,
				generationAdvanced: secondGeneration > firstGeneration,
				afterSecondTimer: tree.visibleNodes.map(v => v.recentlyRefreshed),
			}).toEqual({
				afterFirstTimer: [true, true],
				generationAdvanced: true,
				afterSecondTimer: [false, false],
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('reloadAll folds a repeat press into the pass already running', async () => {
		// Hammering the refresh action must not start a second sweep of the tree: the control stays
		// enabled (a disabled one would steal focus on click), so the extra presses land here.
		const pending = deferred<readonly TreeNode<DemoNode>[]>();
		let reloading = false;
		let signalSubtreeFetchStarted!: () => void;
		const subtreeFetchStarted = new Promise<void>(resolve => { signalSubtreeFetchStarted = resolve; });

		const getRoots = vi.fn(async () => [branch('r0')]);
		const getChildren = vi.fn(async () => {
			if (!reloading) {
				return [leaf('r0.0')];
			}
			signalSubtreeFetchStarted();
			return pending.promise;
		});
		const tree = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			indentWidth: INDENT_WIDTH,
			getRoots,
			getChildren,
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(tree);
		await tree.refresh();
		await tree.expand('r0');

		reloading = true;
		const rootsBefore = getRoots.mock.calls.length;

		const first = tree.reloadAll();

		// Wait until the roots pass has finished and the subtree fetch is in flight. That is the
		// window a second press actually lands in -- pressing during the roots pass is already
		// absorbed by refresh's own re-entrancy, so it would prove nothing.
		await subtreeFetchStarted;
		const second = tree.reloadAll();

		pending.resolve([leaf('r0.0')]);
		await Promise.all([first, second]);

		// A second sweep would have re-run getRoots.
		expect(getRoots.mock.calls.length - rootsBefore).toBe(1);
	});

	it('holds the focused appearance while an overlay owns DOM focus', async () => {
		const tree = await newTree(1, 0);
		tree.setFocused(true);

		// A row's context menu opens: it takes DOM focus, which blurs the tree, but the row it
		// belongs to should keep its active-selection styling.
		const hold = tree.holdFocusAppearance();
		tree.setFocused(false);
		const whileHeld = tree.focused;

		hold.dispose();
		const afterRelease = tree.focused;

		// Disposing twice must not drive the count negative and re-focus the tree.
		hold.dispose();

		expect({ whileHeld, afterRelease, afterDoubleDispose: tree.focused }).toEqual({
			whileHeld: true,
			afterRelease: false,
			afterDoubleDispose: false,
		});
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
			indentWidth: INDENT_WIDTH,
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
			indentWidth: INDENT_WIDTH,
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

	it('insets each row by its depth and repaints when the indent width changes', async () => {
		const instance = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			indentWidth: 20,
			getRoots: async () => [branch('r0')],
			getChildren: async () => [leaf('r0.0')],
			renderNode: visible => <span>{visible.node.data.label}</span>,
		});
		store.add(instance);
		await instance.refresh();
		await instance.expand('r0');
		rtl.render(<PositronTree instance={instance} />);

		// One spacer per row, in visible order: the root sits at depth 0 and its child at depth 1,
		// so only the child is inset.
		const indents = async () =>
			(await screen.findAllByTestId('positron-tree-indent')).map(el => el.style.width);
		expect(await indents()).toEqual(['0px', '20px']);

		// Narrowing the indent repaints the existing rows in place -- nothing is re-fetched and the
		// expansion is untouched, so the child is still on screen at its new inset.
		instance.setIndentWidth(8);
		await waitFor(async () => expect(await indents()).toEqual(['0px', '8px']));
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

	it('makes a stale row\'s twisty inert while an ancestor refreshes', async () => {
		const pending = deferred<readonly TreeNode<DemoNode>[]>();
		let reloading = false;
		const instance = makeTree(
			async () => [branch('r0')],
			async node => reloading && node.id === 'r0' ? pending.promise : [branch('r0.c')]
		);
		await instance.refresh();
		await instance.expand('r0');
		rtl.render(<PositronTree instance={instance} />);

		// Before the refresh, r0.c offers an Expand affordance.
		expect(await screen.findByRole('button', { name: 'Expand' })).toBeInTheDocument();

		reloading = true;
		const reload = instance.reload('r0');

		// While r0 refreshes, r0.c is stale: expanding it would fetch against a resource the
		// refresh may already have released, so the twisty loses its label and is disabled.
		await waitFor(() => expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument());
		// The row is still on screen -- a reload doesn't empty the subtree before its replacement.
		expect(screen.getByText('r0.c')).toBeInTheDocument();

		pending.resolve([branch('r0.c')]);
		await reload;

		// Once the replacement lands the affordance comes back.
		expect(await screen.findByRole('button', { name: 'Expand' })).toBeInTheDocument();
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
