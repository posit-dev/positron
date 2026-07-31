/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as DOM from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor, IEditorMouseEvent, IMouseTarget, IPartialEditorMouseEvent, MouseTargetType } from '../../../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../../../editor/common/config/editorOptions.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { ICursorPositionChangedEvent } from '../../../../../editor/common/cursorEvents.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { attachCellEditorContainerScrolling, getDragScrollSpeed, getRevealScrollDelta } from '../../browser/notebookCells/cellEditorContainerScrolling.js';

describe('getDragScrollSpeed', () => {
	it('scales up with distance from the container edge', () => {
		const nearSpeed = getDragScrollSpeed(1, 20);
		const midSpeed = getDragScrollSpeed(2.5, 20);
		const farSpeed = getDragScrollSpeed(10, 20);
		expect(nearSpeed).toBeLessThan(midSpeed);
		expect(midSpeed).toBeLessThan(farSpeed);
	});

	it('enforces minimum speeds for small viewports', () => {
		expect(getDragScrollSpeed(1, 1)).toBe(30);
		expect(getDragScrollSpeed(2, 1)).toBe(60);
		expect(getDragScrollSpeed(5, 1)).toBe(200);
	});
});

describe('getRevealScrollDelta', () => {
	it('returns 0 when the cursor is already visible', () => {
		expect(getRevealScrollDelta(200, 18, 100, 500)).toBe(0);
	});

	it('scrolls up (negative) when the cursor is above the viewport', () => {
		expect(getRevealScrollDelta(50, 18, 100, 500)).toBeLessThan(0);
	});

	it('scrolls down (positive) when the cursor is below the viewport', () => {
		expect(getRevealScrollDelta(600, 18, 100, 500)).toBeGreaterThan(0);
	});

	it('scrolls just far enough to reveal the cursor plus the margin', () => {
		// Cursor bottom at 618, viewport bottom at 500, margin 8 -> 618 - 492 = 126
		expect(getRevealScrollDelta(600, 18, 100, 500)).toBe(126);
	});
});

describe('attachCellEditorContainerScrolling', () => {
	const disposables = new DisposableStore();

	/** Container viewport: top 100, bottom 500, height 400. */
	const CONTAINER_RECT = new DOMRect(0, 100, 800, 400);
	/** Editor spans well past the container on both sides (tall cell mid-scroll). */
	const TALL_EDITOR_RECT = new DOMRect(50, -400, 700, 2400);
	/** Editor fully visible inside the container (short cell). */
	const SHORT_EDITOR_RECT = new DOMRect(50, 120, 700, 200);

	let onMouseDown: Emitter<IEditorMouseEvent>;
	let onMouseDrag: Emitter<IPartialEditorMouseEvent>;
	let onDidChangeCursorPosition: Emitter<ICursorPositionChangedEvent>;
	let container: HTMLElement;
	let editorDomNode: HTMLElement;
	let editorRect: DOMRect;
	let editor: ICodeEditor;
	let setSelection: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		onMouseDown = disposables.add(new Emitter<IEditorMouseEvent>());
		onMouseDrag = disposables.add(new Emitter<IPartialEditorMouseEvent>());
		onDidChangeCursorPosition = disposables.add(new Emitter<ICursorPositionChangedEvent>());

		container = document.createElement('div');
		container.getBoundingClientRect = () => CONTAINER_RECT;
		document.body.appendChild(container);

		editorRect = TALL_EDITOR_RECT;
		editorDomNode = document.createElement('div');
		editorDomNode.getBoundingClientRect = () => editorRect;
		container.appendChild(editorDomNode);

		setSelection = vi.fn();
		editor = stubInterface<ICodeEditor>({
			onMouseDown: onMouseDown.event,
			onMouseDrag: onMouseDrag.event,
			onDidChangeCursorPosition: onDidChangeCursorPosition.event,
			getDomNode: () => editorDomNode,
			getOption: ((id: EditorOption) => id === EditorOption.lineHeight ? 18 : undefined) as ICodeEditor['getOption'],
			getSelection: () => new Selection(1, 1, 2, 5),
			getSelections: () => [new Selection(1, 1, 2, 5)],
			getTargetAtClientPoint: () => stubInterface<IMouseTarget>({
				position: new Position(10, 3),
			}),
			getScrolledVisiblePosition: () => ({ top: 900, left: 10, height: 18 }),
			setSelection,
		});

		const instance = stubInterface<IPositronNotebookInstance>({
			cellsContainer: container,
		});
		disposables.add(attachCellEditorContainerScrolling(editor, instance));
	});

	afterEach(() => {
		disposables.clear();
		container.remove();
	});

	/** Fire a left-button mousedown on editor text at the given client coords. */
	function mouseDown(x: number, y: number, overrides: { altKey?: boolean; targetType?: MouseTargetType } = {}) {
		onMouseDown.fire(stubInterface<IEditorMouseEvent>({
			event: stubInterface<IEditorMouseEvent['event']>({
				leftButton: true,
				altKey: overrides.altKey ?? false,
				posx: x,
				posy: y,
			}),
			target: stubInterface<IMouseTarget>({
				type: overrides.targetType ?? MouseTargetType.CONTENT_TEXT,
			}),
		}));
	}

	function pointerMove(x: number, y: number) {
		DOM.getWindow(container).dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
	}

	function pointerUp() {
		DOM.getWindow(container).dispatchEvent(new MouseEvent('pointerup'));
	}

	/** Wait for two animation frames so at least one scroll tick runs. */
	async function waitFrames() {
		const targetWindow = DOM.getWindow(container);
		await new Promise(resolve => targetWindow.requestAnimationFrame(() => targetWindow.requestAnimationFrame(resolve)));
	}

	it('scrolls the container down while dragging below it', async () => {
		mouseDown(400, 300);
		pointerMove(400, 600); // 100px below the container bottom
		await waitFrames();

		expect(container.scrollTop).toBeGreaterThan(0);
	});

	it('scrolls the container up while dragging above it', async () => {
		container.scrollTop = 500;
		mouseDown(400, 300);
		pointerMove(400, 50); // 50px above the container top
		await waitFrames();

		expect(container.scrollTop).toBeLessThan(500);
	});

	it('extends the selection from its anchor to the position under the pointer', async () => {
		mouseDown(400, 300);
		pointerMove(400, 600);
		await waitFrames();

		expect(setSelection).toHaveBeenCalledWith(
			Selection.fromPositions(new Position(1, 1), new Position(10, 3)),
			'mouse'
		);
	});

	it('stops scrolling on pointer up', async () => {
		mouseDown(400, 300);
		pointerMove(400, 600);
		await waitFrames();
		pointerUp();

		const scrollTopAfterUp = container.scrollTop;
		await waitFrames();
		expect(container.scrollTop).toBe(scrollTopAfterUp);
	});

	it('stops scrolling when the pointer moves back inside the container', async () => {
		mouseDown(400, 300);
		pointerMove(400, 600);
		await waitFrames();
		pointerMove(400, 300);
		await waitFrames();

		const scrollTopInside = container.scrollTop;
		await waitFrames();
		expect(container.scrollTop).toBe(scrollTopInside);
	});

	it('does not react to pointer moves without a preceding editor mousedown', async () => {
		pointerMove(400, 600);
		await waitFrames();

		expect(container.scrollTop).toBe(0);
		expect(setSelection).not.toHaveBeenCalled();
	});

	it('does not start for mousedown outside selectable targets (e.g. scrollbar)', async () => {
		mouseDown(400, 300, { targetType: MouseTargetType.SCROLLBAR });
		pointerMove(400, 600);
		await waitFrames();

		expect(container.scrollTop).toBe(0);
	});

	it('scrolls but does not extend selection for alt-drags (multi-cursor gestures)', async () => {
		mouseDown(400, 300, { altKey: true });
		pointerMove(400, 600);
		await waitFrames();

		expect(container.scrollTop).toBeGreaterThan(0);
		expect(setSelection).not.toHaveBeenCalled();
	});

	it('does not scroll when the editor is already fully visible (short cell)', async () => {
		editorRect = SHORT_EDITOR_RECT;
		mouseDown(400, 200);
		pointerMove(400, 600);
		await waitFrames();

		expect(container.scrollTop).toBe(0);
	});

	it('stops entirely when a text drag-and-drop begins', async () => {
		mouseDown(400, 300);
		onMouseDrag.fire(stubInterface<IPartialEditorMouseEvent>({}));
		pointerMove(400, 600);
		await waitFrames();

		expect(container.scrollTop).toBe(0);
	});

	it('reveals the cursor on keyboard-driven moves below the viewport', () => {
		// Cursor top = editor top (-400) + 900 = 500; container bottom = 500.
		// Delta = (500 + 18) - (500 - 8) = 26.
		onDidChangeCursorPosition.fire(stubInterface<ICursorPositionChangedEvent>({
			source: 'keyboard',
			position: new Position(50, 1),
		}));

		expect(container.scrollTop).toBe(26);
	});

	it('ignores cursor moves from non-keyboard sources', () => {
		onDidChangeCursorPosition.fire(stubInterface<ICursorPositionChangedEvent>({
			source: 'mouse',
			position: new Position(50, 1),
		}));

		expect(container.scrollTop).toBe(0);
	});
});
