/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { DisposableStore, IDisposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor, MouseTargetType } from '../../../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../../../editor/common/config/editorOptions.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';

/**
 * Positron notebook cell editors render at full content height and the notebook
 * scrolls via CSS overflow on the cells container. Monaco therefore never has an
 * internal viewport to scroll, so two behaviors that normal editors get for free
 * are missing:
 *
 * - Drag-selecting past the top/bottom edge of the notebook viewport does not
 *   auto-scroll the notebook (Monaco's TopBottomDragScrolling only scrolls the
 *   editor's own viewport, which spans the full content).
 * - Keyboard selection/navigation (Shift+Down, Shift+Cmd+Down, etc.) reveals the
 *   cursor within the editor, which never translates into notebook scrolling.
 *
 * This module attaches container-level analogs of both behaviors to a cell editor.
 */

/** Extra space kept between the cursor and the container edge on keyboard reveal. */
const REVEAL_MARGIN = 8;

/**
 * Scroll speed while drag-selecting outside the container, in lines per second.
 * Mirrors the speed curve of Monaco's TopBottomDragScrollingOperation so notebook
 * auto-scroll feels the same as editor auto-scroll.
 * @param outsideDistanceInLines How far the pointer is beyond the container edge.
 * @param viewportInLines Container height expressed in editor lines.
 */
export function getDragScrollSpeed(outsideDistanceInLines: number, viewportInLines: number): number {
	if (outsideDistanceInLines <= 1.5) {
		return Math.max(30, viewportInLines * (1 + outsideDistanceInLines));
	}
	if (outsideDistanceInLines <= 3) {
		return Math.max(60, viewportInLines * (2 + outsideDistanceInLines));
	}
	return Math.max(200, viewportInLines * (7 + outsideDistanceInLines));
}

/**
 * Scroll adjustment that brings a cursor into the container viewport.
 * @param cursorTop Cursor top edge, in the same coordinate space as the container bounds.
 * @param cursorHeight Height of the cursor (line height at the cursor).
 * @param containerTop Container viewport top edge.
 * @param containerBottom Container viewport bottom edge.
 * @returns Signed scrollTop delta; 0 when the cursor is already visible.
 */
export function getRevealScrollDelta(cursorTop: number, cursorHeight: number, containerTop: number, containerBottom: number): number {
	if (cursorTop < containerTop + REVEAL_MARGIN) {
		return cursorTop - (containerTop + REVEAL_MARGIN);
	}
	const cursorBottom = cursorTop + cursorHeight;
	if (cursorBottom > containerBottom - REVEAL_MARGIN) {
		return cursorBottom - (containerBottom - REVEAL_MARGIN);
	}
	return 0;
}

/** Mouse-down targets that begin a text selection drag. */
const SELECTION_DRAG_TARGETS = new Set<MouseTargetType>([
	MouseTargetType.CONTENT_TEXT,
	MouseTargetType.CONTENT_EMPTY,
	MouseTargetType.GUTTER_LINE_NUMBERS,
]);

/**
 * Keep the notebook cells container scrolled to follow selection in a cell editor:
 * auto-scroll during drag-selection past the container edge, and reveal the cursor
 * on keyboard-driven moves.
 */
export function attachCellEditorContainerScrolling(editor: ICodeEditor, instance: IPositronNotebookInstance): IDisposable {
	const disposables = new DisposableStore();

	// --- Drag auto-scroll ---------------------------------------------------

	// Holds the listeners and animation frame of the active drag; cleared on pointer up.
	const activeDrag = disposables.add(new MutableDisposable<DisposableStore>());

	disposables.add(editor.onMouseDown(e => {
		if (!e.event.leftButton || !SELECTION_DRAG_TARGETS.has(e.target.type)) {
			return;
		}
		const editorDomNode = editor.getDomNode();
		if (!editorDomNode) {
			return;
		}

		const dragDisposables = new DisposableStore();
		activeDrag.value = dragDisposables;

		const targetWindow = DOM.getWindow(editorDomNode);

		// Alt starts column selection / multi-cursor gestures; collapsing those to a
		// single selection from our animation ticks would destroy them, so we still
		// auto-scroll but leave selection extension to Monaco's own pointermove handling.
		const extendSelection = !e.event.altKey;

		// Last observed pointer position, updated on every move.
		let pointerX = e.event.posx - targetWindow.scrollX;
		let pointerY = e.event.posy - targetWindow.scrollY;
		let lastTickTime: number | undefined;
		const animationFrame = dragDisposables.add(new MutableDisposable<IDisposable>());

		const stopScrolling = () => {
			animationFrame.clear();
			lastTickTime = undefined;
		};

		const tick = () => {
			const container = instance.cellsContainer;
			if (!container) {
				stopScrolling();
				return;
			}

			// How far is the pointer beyond the container's vertical bounds?
			const containerRect = container.getBoundingClientRect();
			const outsideDistance = pointerY < containerRect.top
				? containerRect.top - pointerY
				: pointerY > containerRect.bottom
					? pointerY - containerRect.bottom
					: 0;
			if (outsideDistance === 0) {
				stopScrolling();
				return;
			}
			const direction = pointerY < containerRect.top ? -1 : 1;

			// Stop once the editor edge being dragged toward is visible: every
			// selectable line of this cell is then on screen, and further scrolling
			// would just move unrelated notebook content past the pointer.
			const editorRect = editorDomNode.getBoundingClientRect();
			if (direction > 0 ? editorRect.bottom <= containerRect.bottom : editorRect.top >= containerRect.top) {
				stopScrolling();
				return;
			}

			// Scroll the container at a speed based on how far outside the pointer is.
			const now = Date.now();
			const elapsedMs = lastTickTime === undefined ? 16 : now - lastTickTime;
			lastTickTime = now;
			const lineHeight = editor.getOption(EditorOption.lineHeight);
			const speedInLines = getDragScrollSpeed(outsideDistance / lineHeight, containerRect.height / lineHeight);
			container.scrollTop += direction * speedInLines * (elapsedMs / 1000) * lineHeight;

			// Extend the selection to the position now under the pointer. The container
			// scrolled beneath a (possibly stationary) pointer, so Monaco won't see a
			// pointermove event; hit-test ourselves with coordinates clamped into the
			// editor so getTargetAtClientPoint always resolves a position.
			if (extendSelection) {
				const selection = editor.getSelection();
				const selections = editor.getSelections();
				const clampedX = Math.min(Math.max(pointerX, editorRect.left + 1), editorRect.right - 1);
				const clampedY = Math.min(Math.max(pointerY, editorRect.top + 1), editorRect.bottom - 1);
				const target = editor.getTargetAtClientPoint(clampedX, clampedY);
				if (selection && selections?.length === 1 && target?.position) {
					const anchor = new Position(selection.selectionStartLineNumber, selection.selectionStartColumn);
					editor.setSelection(Selection.fromPositions(anchor, target.position), 'mouse');
				}
			}

			animationFrame.value = DOM.scheduleAtNextAnimationFrame(targetWindow, tick);
		};

		dragDisposables.add(DOM.addDisposableListener(targetWindow, 'pointermove', (event: PointerEvent) => {
			pointerX = event.clientX;
			pointerY = event.clientY;
			// Start the scroll loop when the pointer leaves the container vertically.
			// The loop stops itself when the pointer re-enters.
			const container = instance.cellsContainer;
			if (!container || animationFrame.value) {
				return;
			}
			const containerRect = container.getBoundingClientRect();
			if (pointerY < containerRect.top || pointerY > containerRect.bottom) {
				animationFrame.value = DOM.scheduleAtNextAnimationFrame(targetWindow, tick);
			}
		}, true));

		const endDrag = () => activeDrag.clear();
		dragDisposables.add(DOM.addDisposableListener(targetWindow, 'pointerup', endDrag, true));
		dragDisposables.add(DOM.addDisposableListener(targetWindow, 'pointercancel', endDrag, true));

		// Monaco only fires onMouseDrag in text drag-and-drop mode (dragging the
		// selected text itself). Auto-scrolling and selection extension would both
		// interfere with the drop gesture, so bail out entirely.
		dragDisposables.add(editor.onMouseDrag(endDrag));
	}));

	// --- Keyboard cursor reveal ----------------------------------------------

	disposables.add(editor.onDidChangeCursorPosition(e => {
		// Only follow keyboard-driven moves (arrow selection, Shift+Cmd+Down, typing).
		// Mouse moves are handled by the drag logic above, and programmatic moves
		// (e.g. our own setSelection calls) must not trigger extra scrolling.
		if (e.source !== 'keyboard') {
			return;
		}
		const container = instance.cellsContainer;
		const editorDomNode = editor.getDomNode();
		if (!container || !editorDomNode) {
			return;
		}
		const cursorPosition = editor.getScrolledVisiblePosition(e.position);
		if (!cursorPosition) {
			return;
		}
		const containerRect = container.getBoundingClientRect();
		const cursorTop = editorDomNode.getBoundingClientRect().top + cursorPosition.top;
		const delta = getRevealScrollDelta(cursorTop, cursorPosition.height, containerRect.top, containerRect.bottom);
		if (delta !== 0) {
			container.scrollTop += delta;
		}
	}));

	return disposables;
}
