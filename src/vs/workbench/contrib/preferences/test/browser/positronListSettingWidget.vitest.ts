/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ListSettingWidget, IListDataItem, SettingListEvent } from '../../browser/settingsWidgets.js';
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
});
