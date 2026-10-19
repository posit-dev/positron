/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IReorderListItem, PositronReorderListWidget } from '../../browser/positronReorderListWidget.js';
import { SettingListEvent } from '../../browser/settingsWidgets.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';

describe('PositronReorderListWidget', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	const toItems = (values: string[]): IReorderListItem[] => values.map(data => ({ value: { type: 'string', data }, label: data.toUpperCase() }));

	function createWidget(values: string[]) {
		const container = document.createElement('div');
		document.body.appendChild(container);
		ctx.disposables.add({ dispose: () => container.remove() });
		const widget = ctx.disposables.add(ctx.instantiationService.createInstance(PositronReorderListWidget, container));
		const events: SettingListEvent<IReorderListItem>[] = [];
		ctx.disposables.add(widget.onDidChangeList(e => events.push(e)));
		widget.setValue(toItems(values));
		// eslint-disable-next-line no-restricted-syntax -- upstream widget has no roles or test ids on its rows
		const rows = () => Array.from(container.querySelectorAll<HTMLElement>('.setting-list-row'));
		return { widget, container, events, rows, list: widget.domNode };
	}

	// eslint-disable-next-line no-restricted-syntax -- upstream widget has no roles or test ids on its rows
	const rowLabels = (rows: () => HTMLElement[]) => rows().map(r => r.querySelector('.setting-list-value')?.textContent);

	function findAction(row: HTMLElement, label: string) {
		// eslint-disable-next-line no-restricted-syntax -- action bar items have no roles or test ids
		return row.querySelector<HTMLElement>(`.action-label[aria-label="${label}"]`);
	}

	function clickAction(row: HTMLElement, label: string) {
		const button = findAction(row, label);
		expect(button).not.toBeNull();
		button!.click();
	}

	function pointerDown(row: HTMLElement) {
		const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
		row.dispatchEvent(event);
		return event;
	}

	function pressKey(target: HTMLElement, key: 'ArrowUp' | 'ArrowDown', altKey: boolean) {
		const event = new KeyboardEvent('keydown', { key, code: key, keyCode: key === 'ArrowUp' ? 38 : 40, altKey, bubbles: true, cancelable: true });
		target.dispatchEvent(event);
		return event;
	}

	it('selects a row on pointerdown without cancelling it, so a native drag can start', () => {
		const { rows } = createWidget(['a', 'b']);
		const event = pointerDown(rows()[1]);
		expect(event.defaultPrevented).toBe(false);
		expect(rows()[1]).toHaveClass('selected');
		expect(rows()[0]).not.toHaveClass('selected');
	});

	it('dropping a row on another moves it there', () => {
		const { rows, events } = createWidget(['a', 'b', 'c']);
		rows()[2].dispatchEvent(new Event('dragstart', { bubbles: true }));
		rows()[0].dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
		expect(events).toEqual([expect.objectContaining({ type: 'move', sourceIndex: 2, targetIndex: 0 })]);
		expect(rowLabels(rows)).toEqual(['C', 'A', 'B']);
		expect(rows()[0]).toHaveClass('selected');
	});

	it('ignores a drop that did not start in the list', () => {
		const { rows, events } = createWidget(['a', 'b']);
		rows()[0].dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
		expect(events).toEqual([]);
		expect(rowLabels(rows)).toEqual(['A', 'B']);
	});

	it('Move Down and Move Up fire moves to the adjacent index', () => {
		const { rows, events } = createWidget(['a', 'b', 'c']);
		clickAction(rows()[0], 'Move Down');
		clickAction(rows()[2], 'Move Up');
		expect(events).toEqual([
			expect.objectContaining({ type: 'move', sourceIndex: 0, targetIndex: 1 }),
			expect.objectContaining({ type: 'move', sourceIndex: 2, targetIndex: 1 }),
		]);
	});

	it('disables Move Up on the first row and Move Down on the last', () => {
		const { rows } = createWidget(['a', 'b']);
		expect(findAction(rows()[0], 'Move Up')).toHaveClass('disabled');
		expect(findAction(rows()[1], 'Move Down')).toHaveClass('disabled');
	});

	it('shows only the move buttons, and none when there is one row', () => {
		const { rows } = createWidget(['a', 'b']);
		// eslint-disable-next-line no-restricted-syntax -- action bar items have no roles or test ids
		const labels = Array.from(rows()[0].querySelectorAll('.action-label')).map(el => el.getAttribute('aria-label'));
		expect(labels).toEqual(['Move Up', 'Move Down']);
		expect(findAction(createWidget(['a']).rows()[0], 'Move Up')).toBeNull();
	});

	it('clicking Move Down twice on the same item moves it twice', () => {
		const { rows, events } = createWidget(['a', 'b', 'c']);
		clickAction(rows()[0], 'Move Down');
		clickAction(rows()[1], 'Move Down');
		expect(events[1]).toEqual(expect.objectContaining({ type: 'move', sourceIndex: 1, targetIndex: 2 }));
		expect(rowLabels(rows)).toEqual(['B', 'C', 'A']);
	});

	it('two quick Alt+Down presses move the selected row twice', () => {
		const { list, rows, events } = createWidget(['a', 'b', 'c']);
		pointerDown(rows()[0]);
		const event = pressKey(list, 'ArrowDown', true);
		pressKey(list, 'ArrowDown', true);
		expect(event.defaultPrevented).toBe(true);
		expect(events).toEqual([
			expect.objectContaining({ type: 'move', sourceIndex: 0, targetIndex: 1 }),
			expect.objectContaining({ type: 'move', sourceIndex: 1, targetIndex: 2 }),
		]);
		expect(events[1]).toEqual(expect.objectContaining({ originalItem: expect.objectContaining({ value: { type: 'string', data: 'a' } }) }));
		expect(rowLabels(rows)).toEqual(['B', 'C', 'A']);
		expect(rows()[2]).toHaveClass('selected');
	});

	it('Alt+Up on the first row does nothing but still swallows the key', () => {
		const { list, rows, events } = createWidget(['a', 'b']);
		pointerDown(rows()[0]);
		const event = pressKey(list, 'ArrowUp', true);
		expect(events).toEqual([]);
		expect(event.defaultPrevented).toBe(true);
	});

	it('Alt+Down with no selection is left alone', () => {
		const { list, events } = createWidget(['a', 'b']);
		const event = pressKey(list, 'ArrowDown', true);
		expect(events).toEqual([]);
		expect(event.defaultPrevented).toBe(false);
	});

	it('plain Down only changes the selection', () => {
		const { list, rows, events } = createWidget(['a', 'b']);
		pointerDown(rows()[0]);
		pressKey(list, 'ArrowDown', false);
		expect(events).toEqual([]);
		expect(rows()[1]).toHaveClass('selected');
	});

	it('keeps the moved row selected and focused when the settings tree re-renders the list', () => {
		const { widget, list, rows } = createWidget(['a', 'b', 'c']);
		pointerDown(rows()[0]);
		pressKey(list, 'ArrowDown', true);
		expect(rows()[1]).toHaveFocus();
		// What the settings tree does once the setting saves.
		widget.cancelEdit();
		widget.setValue(toItems(['b', 'a', 'c']));
		// Without waiting: a frame with focus outside the list flashes the setting's border.
		expect(rows()[1]).toHaveFocus();
		expect(rows()[1]).toHaveClass('selected');
	});

	it('shows a drag handle and the label on each row, and hides the Add button', () => {
		const { container, rows } = createWidget(['r']);
		// eslint-disable-next-line no-restricted-syntax -- decorative handle has no role or test id
		expect(rows()[0].querySelector('.setting-list-drag-handle')).not.toBeNull();
		expect(rows()[0]).toHaveAttribute('aria-label', 'List item `R`');
		expect(rowLabels(rows)).toEqual(['R']);
		expect(container).toHaveClass('setting-list-hide-add-button');
	});

	it('does not edit on double-click', () => {
		const { rows, container } = createWidget(['a', 'b']);
		rows()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		// eslint-disable-next-line no-restricted-syntax -- upstream widget has no roles or test ids
		expect(container.querySelector('.setting-list-edit-row')).toBeNull();
	});
});
