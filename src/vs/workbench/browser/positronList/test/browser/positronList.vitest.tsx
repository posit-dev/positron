/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// React.
import React from 'react';

// Testing libraries.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Other dependencies.
import { isMacintosh } from '../../../../../base/common/platform.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronList } from '../../positronList.js';
import { ListEntry, PositronListInstance } from '../../classes/positronListInstance.js';

// The harness in the control gallery uses these dimensions; mirror them so row math is concrete.
const ITEM_HEIGHT = 24;
const SECTION_HEIGHT = 32;

// A layout size that produces a scrollable viewport: short enough that 200 rows overflow it.
const VIEWPORT_WIDTH = 300;
const VIEWPORT_HEIGHT = 100;

// A viewport tall enough to render a handful of rows at once, for the rendering assertions.
const TALL_VIEWPORT_HEIGHT = 400;

/**
 * The data grid sizes itself from the DOM via requestAnimationFrame + ResizeObserver. Neither
 * produces a real layout in happy-dom, so neutralize them and drive the size explicitly with
 * instance.setSize. Stubbing rAF to a no-op also stops a late frame from resetting that size to 0.
 * Callers must pair this with vi.unstubAllGlobals() in afterEach.
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
 * Like stubGridLayout, but for tests that assert on rendered rows rather than instance state:
 * the data grid only paints the rows that fit its *local* height, which it learns from the DOM.
 * happy-dom reports 0 for every measurement, so this gives elements a real offset size and hands
 * that size to the grid synchronously via a ResizeObserver that fires on observe(). Returns a
 * restore function for the offset overrides; callers must also call vi.unstubAllGlobals().
 */
function stubGridLayoutWithSize(width: number, height: number): () => void {
	const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
	const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
	Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => width });
	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height });

	// rAF stays a no-op; the size instead arrives from the ResizeObserver below.
	vi.stubGlobal('requestAnimationFrame', () => 0);
	vi.stubGlobal('ResizeObserver', class {
		private readonly _callback: ResizeObserverCallback;
		constructor(callback: ResizeObserverCallback) { this._callback = callback; }
		observe() {
			// Report the stubbed size immediately so the grid sizes itself during render.
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

/**
 * Builds a flat list of item entries (no sections), matching the gallery harness's flat mode.
 */
function flatItems(count: number): ListEntry<string, never>[] {
	const entries: ListEntry<string, never>[] = [];
	for (let i = 0; i < count; i++) {
		entries.push({ kind: 'item', item: `Item ${i + 1}` });
	}
	return entries;
}

/**
 * The "jump to top / jump to bottom" chord. The data grid binds it to Cmd on macOS and Ctrl
 * elsewhere (on macOS, Ctrl+Home/End is a deliberate no-op), so the test picks the modifier
 * that actually fires on the host it runs on. See dataGridWaffle.tsx's Home/End handlers.
 */
function jumpChord(key: 'Home' | 'End'): string {
	return isMacintosh ? `{Meta>}{${key}}{/Meta}` : `{Control>}{${key}}{/Control}`;
}

describe('PositronListInstance', () => {
	// Instance-level behavior needs no rendering -- it's a plain class. The builder is still used
	// so its disposable-leak detection covers the instances created here.
	createTestContainer().build();

	let store: DisposableStore;
	beforeEach(() => { store = new DisposableStore(); });
	afterEach(() => store.dispose());

	function newList(): PositronListInstance<string, string> {
		const instance = new PositronListInstance<string, string>({
			itemRenderer: item => <div>{item}</div>,
			sectionRenderer: section => <div>{section}</div>,
			itemHeight: ITEM_HEIGHT,
			sectionHeight: SECTION_HEIGHT,
		});
		store.add(instance);
		return instance;
	}

	it('reports row count and selectable range for a flat list', () => {
		const list = newList();
		list.setEntries(flatItems(5));

		expect({
			rows: list.rows,
			first: list.firstSelectableRowIndex,
			last: list.lastSelectableRowIndex,
		}).toMatchInlineSnapshot(`
			{
			  "first": 0,
			  "last": 4,
			  "rows": 5,
			}
		`);
	});

	it('treats section headers as non-selectable and advances the cursor off a leading section', () => {
		const list = newList();
		// A section header followed by two items: index 0 is the header, 1 and 2 are items.
		list.setEntries([
			{ kind: 'section', section: 'Section 1' },
			{ kind: 'item', item: 'Item 1' },
			{ kind: 'item', item: 'Item 2' },
		]);

		expect({
			sectionSelectable: list.isRowSelectable(0),
			itemSelectable: list.isRowSelectable(1),
			cursorRow: list.cursorRowIndex, // advanced past the leading section header
			firstSelectable: list.firstSelectableRowIndex,
		}).toMatchInlineSnapshot(`
			{
			  "cursorRow": 1,
			  "firstSelectable": 1,
			  "itemSelectable": true,
			  "sectionSelectable": false,
			}
		`);
	});

	it('returns selected items in entry order, skipping sections', () => {
		const list = newList();
		list.setEntries(flatItems(4));
		list.selectRow(2);

		expect(list.getSelectedItems()).toEqual(['Item 3']);
	});

	it('exposes a maximum vertical scroll offset once a viewport size is set', async () => {
		const list = newList();
		list.setEntries(flatItems(200));
		// Without a size, layoutHeight is 0 and the max offset is unbounded/meaningless; setSize
		// is what ResizeObserver would supply in the running app.
		await list.setSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

		// scrollHeight = 200 * 24 = 4800; max offset = 4800 - viewport(100) = 4700.
		expect(list.maximumVerticalScrollOffset).toBe(4700);
	});
});

describe('PositronList keyboard navigation', () => {
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
	 * Builds a list instance. selectionFollowsCursor mirrors the option that makes the selection
	 * collapse onto the cursor after every navigation move (default false, as in the gallery).
	 */
	function makeList(selectionFollowsCursor = false): PositronListInstance<string, string> {
		const common = {
			itemRenderer: (item: string) => <div>{item}</div>,
			sectionRenderer: (section: string) => <div>{section}</div>,
			itemHeight: ITEM_HEIGHT,
			sectionHeight: SECTION_HEIGHT,
		};
		const instance = selectionFollowsCursor
			? new PositronListInstance<string, string>({ ...common, selectionFollowsCursor: true })
			: new PositronListInstance<string, string>({ ...common, selectionFollowsCursor: false });
		store.add(instance);
		return instance;
	}

	/**
	 * Renders a list instance, supplies the viewport size the real app gets from layout, and
	 * focuses the grid so key events land on it (and the instance reports itself focused).
	 */
	async function renderList(instance: PositronListInstance<string, string>, entries: ListEntry<string, string>[]) {
		instance.setEntries(entries);
		rtl.render(<PositronList instance={instance} />);
		await instance.setSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		screen.getByRole('grid').focus();
	}

	it('Cmd/Ctrl+End jumps the cursor and viewport to the last row', async () => {
		const user = userEvent.setup();
		const instance = makeList();
		await renderList(instance, flatItems(200));

		await user.keyboard(jumpChord('End'));

		await waitFor(() => {
			expect({
				cursor: instance.cursorRowIndex,
				scroll: instance.verticalScrollOffset,
			}).toEqual({
				cursor: instance.lastSelectableRowIndex, // 199
				scroll: instance.maximumVerticalScrollOffset, // 4700
			});
		});
	});

	it('Cmd/Ctrl+Home returns the cursor and viewport to the first row', async () => {
		const user = userEvent.setup();
		const instance = makeList();
		await renderList(instance, flatItems(200));

		// Jump to the bottom first so Home has something to undo.
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

	it('Down/Up arrows move the cursor and skip section headers', async () => {
		const user = userEvent.setup();
		const instance = makeList();
		// 0:section 1:Item 1 2:Item 2 3:section 4:Item 3. The cursor starts on row 1 (setEntries
		// advances it off the leading section header).
		await renderList(instance, [
			{ kind: 'section', section: 'Section 1' },
			{ kind: 'item', item: 'Item 1' },
			{ kind: 'item', item: 'Item 2' },
			{ kind: 'section', section: 'Section 2' },
			{ kind: 'item', item: 'Item 3' },
		]);
		expect(instance.cursorRowIndex).toBe(1);

		await user.keyboard('{ArrowDown}');
		await waitFor(() => expect(instance.cursorRowIndex).toBe(2));

		// Down from row 2 skips the section header at row 3 and lands on the item at row 4.
		await user.keyboard('{ArrowDown}');
		await waitFor(() => expect(instance.cursorRowIndex).toBe(4));

		// Up from row 4 skips the section header again, back to row 2.
		await user.keyboard('{ArrowUp}');
		await waitFor(() => expect(instance.cursorRowIndex).toBe(2));
	});

	it('selection follows the cursor when selectionFollowsCursor is set', async () => {
		const user = userEvent.setup();
		const instance = makeList(true);
		await renderList(instance, flatItems(5));

		// Cursor starts on row 0 with nothing selected; selection only begins to track on a move.
		expect(instance.getSelectedItems()).toEqual([]);

		await user.keyboard('{ArrowDown}');
		await waitFor(() => expect(instance.getSelectedItems()).toEqual(['Item 2']));
		expect(instance.cursorRowIndex).toBe(1);

		// Single-selection collapses onto the new cursor row, so the prior selection is replaced.
		await user.keyboard('{ArrowDown}');
		await waitFor(() => expect(instance.getSelectedItems()).toEqual(['Item 3']));
		expect(instance.cursorRowIndex).toBe(2);
	});

	it('selection does not follow the cursor by default', async () => {
		const user = userEvent.setup();
		const instance = makeList(); // selectionFollowsCursor defaults to false, as in the gallery
		await renderList(instance, flatItems(5));

		await user.keyboard('{ArrowDown}');
		await waitFor(() => expect(instance.cursorRowIndex).toBe(1));

		// The cursor (focus) moved, but selection is left untouched -- the two stay independent.
		expect(instance.getSelectedItems()).toEqual([]);
	});
});

describe('PositronList rendering', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let store: DisposableStore;
	let restoreLayout: () => void;
	beforeEach(() => {
		store = new DisposableStore();
		// A tall viewport so a handful of rows all paint at once.
		restoreLayout = stubGridLayoutWithSize(VIEWPORT_WIDTH, TALL_VIEWPORT_HEIGHT);
	});
	afterEach(() => {
		store.dispose();
		vi.unstubAllGlobals();
		restoreLayout();
	});

	function makeList(): PositronListInstance<string, string> {
		const instance = new PositronListInstance<string, string>({
			itemRenderer: item => <div>{item}</div>,
			sectionRenderer: section => <div>{section}</div>,
			itemHeight: ITEM_HEIGHT,
			sectionHeight: SECTION_HEIGHT,
		});
		store.add(instance);
		return instance;
	}

	it('wraps item content in a list row and section content in a section', async () => {
		const instance = makeList();
		instance.setEntries([
			{ kind: 'section', section: 'Section 1' },
			{ kind: 'item', item: 'Item 1' },
		]);
		rtl.render(<PositronList instance={instance} />);

		// .closest() walks up to the framework's row/section wrapper around the consumer content.
		const item = await screen.findByText('Item 1');
		const section = await screen.findByText('Section 1');
		expect(item.closest('.positron-list-row')).toBeInTheDocument();
		expect(section.closest('.positron-list-section')).toBeInTheDocument();
	});

	it('marks the cursor row focused (only while the list has focus) and a selected row selected', async () => {
		const instance = makeList();
		instance.setEntries(flatItems(3));
		rtl.render(<PositronList instance={instance} />);

		// Before focus, the cursor row carries no focus ring.
		expect((await screen.findByText('Item 1')).closest('.positron-list-row')).not.toHaveClass('focused');

		// Focusing the list applies the focus ring to the cursor row (row 0) but not its neighbor.
		screen.getByRole('grid').focus();
		await waitFor(() =>
			expect(screen.getByText('Item 1').closest('.positron-list-row')).toHaveClass('focused')
		);
		expect(screen.getByText('Item 2').closest('.positron-list-row')).not.toHaveClass('focused');

		// Selecting a row applies the selected class to that row's wrapper.
		instance.selectRow(2);
		await waitFor(() =>
			expect(screen.getByText('Item 3').closest('.positron-list-row')).toHaveClass('selected')
		);
	});

	it('renders the empty-state renderer when the list has no entries', async () => {
		const instance = makeList();
		// No entries set, so the empty-state branch renders instead of the data grid.
		rtl.render(<PositronList emptyListRenderer={() => <div>Nothing here</div>} instance={instance} />);

		expect(await screen.findByText('Nothing here')).toBeInTheDocument();
	});
});
