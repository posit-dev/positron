/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ListSettingWidget, ExcludeSettingWidget, IListDataItem, IIncludeExcludeDataItem, SettingListEvent } from '../../browser/settingsWidgets.js';
import { SettingValueType } from '../../../../services/preferences/common/preferences.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';

describe('ListSettingWidget reordering', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	function createWidget(values: string[]) {
		const container = document.createElement('div');
		document.body.appendChild(container);
		ctx.disposables.add({ dispose: () => container.remove() });
		const widget = ctx.disposables.add(ctx.instantiationService.createInstance(ListSettingWidget<IListDataItem>, container));
		const events: SettingListEvent<IListDataItem>[] = [];
		ctx.disposables.add(widget.onDidChangeList(e => events.push(e)));
		widget.setValue(values.map(data => ({ value: { type: 'string', data } })));
		// eslint-disable-next-line no-restricted-syntax -- upstream widget has no roles or test ids on its rows
		const rows = () => Array.from(container.querySelectorAll<HTMLElement>('.setting-list-row'));
		return { widget, container, events, rows };
	}

	it('does not cancel pointerdown on a draggable row, so a native drag can start', () => {
		const { rows } = createWidget(['a', 'b']);
		const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
		rows()[1].dispatchEvent(event);
		expect(rows()[1].draggable).toBe(true);
		expect(event.defaultPrevented).toBe(false);
	});

	it('still selects the row on pointerdown', () => {
		const { rows } = createWidget(['a', 'b']);
		rows()[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
		expect(rows()[1]).toHaveClass('selected');
	});

	function findAction(row: HTMLElement, label: string) {
		// eslint-disable-next-line no-restricted-syntax -- action bar items have no roles or test ids
		return row.querySelector<HTMLElement>(`.action-label[aria-label="${label}"]`);
	}

	function clickAction(row: HTMLElement, label: string) {
		const button = findAction(row, label);
		expect(button).not.toBeNull();
		button!.click();
	}

	it('Move Down fires a move from the row to the next index', () => {
		const { rows, events } = createWidget(['a', 'b', 'c']);
		clickAction(rows()[0], 'Move Down');
		expect(events).toEqual([expect.objectContaining({ type: 'move', sourceIndex: 0, targetIndex: 1 })]);
	});

	it('Move Up fires a move from the row to the previous index', () => {
		const { rows, events } = createWidget(['a', 'b', 'c']);
		clickAction(rows()[2], 'Move Up');
		expect(events).toEqual([expect.objectContaining({ type: 'move', sourceIndex: 2, targetIndex: 1 })]);
	});

	it('disables Move Up on the first row and Move Down on the last', () => {
		const { rows } = createWidget(['a', 'b']);
		expect(findAction(rows()[0], 'Move Up')).toHaveClass('disabled');
		expect(findAction(rows()[1], 'Move Down')).toHaveClass('disabled');
	});

	it('shows no move buttons when there is only one row', () => {
		const { rows } = createWidget(['a']);
		expect(findAction(rows()[0], 'Move Up')).toBeNull();
	});

	it('selects the moved row at its new index once the new value renders', () => {
		const { widget, rows } = createWidget(['a', 'b', 'c']);
		clickAction(rows()[0], 'Move Down');
		widget.setValue(['b', 'a', 'c'].map(data => ({ value: { type: 'string', data } })));
		expect(rows()[1]).toHaveClass('selected');
		expect(rows()[1]).toHaveTextContent('a');
	});

	it('renders a drag handle on each row', () => {
		const { rows } = createWidget(['a', 'b']);
		// eslint-disable-next-line no-restricted-syntax -- decorative handle has no role or test id
		expect(rows().every(r => r.querySelector('.setting-list-drag-handle'))).toBe(true);
	});

	function pressKey(target: HTMLElement, key: 'ArrowUp' | 'ArrowDown', altKey: boolean) {
		const event = new KeyboardEvent('keydown', { key, code: key, keyCode: key === 'ArrowUp' ? 38 : 40, altKey, bubbles: true, cancelable: true });
		target.dispatchEvent(event);
		return event;
	}

	function selectFirst(rows: () => HTMLElement[]) {
		rows()[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
	}

	// eslint-disable-next-line no-restricted-syntax -- upstream widget has no roles or test ids
	const listOf = (container: HTMLElement) => container.querySelector<HTMLElement>('.setting-list-widget')!;

	it('Alt+Down moves the selected row down', () => {
		const { container, rows, events } = createWidget(['a', 'b', 'c']);
		selectFirst(rows);
		const event = pressKey(listOf(container), 'ArrowDown', true);
		expect(events).toEqual([expect.objectContaining({ type: 'move', sourceIndex: 0, targetIndex: 1 })]);
		expect(event.defaultPrevented).toBe(true);
	});

	it('Alt+Up on the first row does nothing but still swallows the key', () => {
		const { container, rows, events } = createWidget(['a', 'b']);
		selectFirst(rows);
		const event = pressKey(listOf(container), 'ArrowUp', true);
		expect(events).toEqual([]);
		expect(event.defaultPrevented).toBe(true);
	});

	it('Alt+Down with no selection is left alone', () => {
		const { container, events } = createWidget(['a', 'b']);
		const event = pressKey(listOf(container), 'ArrowDown', true);
		expect(events).toEqual([]);
		expect(event.defaultPrevented).toBe(false);
	});

	it('plain Down still only changes the selection', () => {
		const { container, rows, events } = createWidget(['a', 'b']);
		selectFirst(rows);
		pressKey(listOf(container), 'ArrowDown', false);
		expect(events).toEqual([]);
		expect(rows()[1]).toHaveClass('selected');
	});

	it('non-reorderable widgets get no handle, no move actions, and ignore Alt+Down', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		ctx.disposables.add({ dispose: () => container.remove() });
		const widget = ctx.disposables.add(ctx.instantiationService.createInstance(ExcludeSettingWidget, container));
		const events: SettingListEvent<IIncludeExcludeDataItem>[] = [];
		ctx.disposables.add(widget.onDidChangeList(e => events.push(e)));
		widget.setValue(['a', 'b'].map(data => ({ value: { type: 'string' as const, data }, elementType: SettingValueType.Exclude })));
		// eslint-disable-next-line no-restricted-syntax -- upstream widget has no roles or test ids on its rows
		const rows = Array.from(container.querySelectorAll<HTMLElement>('.setting-list-row'));
		rows[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
		// eslint-disable-next-line no-restricted-syntax -- upstream widget has no roles or test ids
		const list = container.querySelector<HTMLElement>('.setting-list-include-exclude-widget')!;
		const event = pressKey(list, 'ArrowDown', true);
		expect(findAction(rows[0], 'Move Down')).toBeNull();
		// eslint-disable-next-line no-restricted-syntax -- decorative handle has no role or test id
		expect(rows[0].querySelector('.setting-list-drag-handle')).toBeNull();
		expect(events).toEqual([]);
		expect(event.defaultPrevented).toBe(false);
	});

	describe('reorderOnly', () => {
		function createReorderOnly(values: string[]) {
			const result = createWidget(values);
			result.widget.setValue(values.map(data => ({ value: { type: 'string', data } })), { reorderOnly: true, showAddButton: true });
			return result;
		}

		it('shows only the move buttons', () => {
			const { rows } = createReorderOnly(['a', 'b']);
			// eslint-disable-next-line no-restricted-syntax -- action bar items have no roles or test ids
			const labels = Array.from(rows()[0].querySelectorAll('.action-label')).map(el => el.getAttribute('aria-label'));
			expect(labels).toEqual(['Move Up', 'Move Down']);
		});

		it('hides the Add button', () => {
			const { container } = createReorderOnly(['a', 'b']);
			expect(container).toHaveClass('setting-list-hide-add-button');
		});

		it('does not edit on double-click', () => {
			const { rows, container } = createReorderOnly(['a', 'b']);
			rows()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
			// eslint-disable-next-line no-restricted-syntax -- upstream widget has no roles or test ids
			expect(container.querySelector('.setting-list-edit-row')).toBeNull();
		});

		it('shows the enum label instead of the raw value', () => {
			const { widget, rows } = createWidget([]);
			widget.setValue([{ value: { type: 'enum', data: 'r', options: [{ value: 'r', label: 'R' }] } }], { reorderOnly: true });
			// eslint-disable-next-line no-restricted-syntax -- upstream widget has no roles or test ids
			expect(rows()[0].querySelector('.setting-list-value')).toHaveTextContent('R');
		});
	});
});
