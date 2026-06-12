/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { fireEvent, screen } from '@testing-library/react';
import { IAction } from '../../../../../base/common/actions.js';
import { IContextMenuDelegate } from '../../../../../base/browser/contextmenu.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILanguageRuntimeResourceUsage } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { formatCompactMemory } from '../../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';
import { ConsoleResourceMonitor, computeResourceMonitorLayout, RESOURCE_MONITOR_MAX_WIDTH, showResourceMonitorContextMenu } from '../../browser/components/consoleResourceMonitor.js';

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

describe('formatCompactMemory', () => {
	it('keeps the numeric part to at most 3 significant digits', () => {
		expect([
			formatCompactMemory(512),
			formatCompactMemory(203 * MB),
			formatCompactMemory(5.45 * GB),
			formatCompactMemory(10.5 * GB),
			formatCompactMemory(902.45 * MB),
		]).toEqual(['512B', '203MB', '5.45GB', '10.5GB', '902MB']);
	});
});

describe('computeResourceMonitorLayout', () => {
	it('shows nothing when there is no room', () => {
		expect(computeResourceMonitorLayout(0)).toEqual({ showMemory: false, graphWidth: 0 });
		expect(computeResourceMonitorLayout(40)).toEqual({ showMemory: false, graphWidth: 0 });
	});

	it('shows the memory value only when narrow', () => {
		const layout = computeResourceMonitorLayout(80);
		expect(layout.showMemory).toBe(true);
		expect(layout.graphWidth).toBe(0);
	});

	it('adds a graph that grows with available width', () => {
		const layout = computeResourceMonitorLayout(180);
		expect(layout.showMemory).toBe(true);
		expect(layout.graphWidth).toBeGreaterThanOrEqual(50);
		expect(layout.graphWidth).toBeLessThanOrEqual(150);
	});

	it('shows a full-width graph at the maximum width', () => {
		expect(computeResourceMonitorLayout(RESOURCE_MONITOR_MAX_WIDTH)).toEqual({
			showMemory: true,
			graphWidth: 150,
		});
	});

	it('degrades monotonically as width shrinks', () => {
		// Walk widths from wide to narrow and assert the feature set never
		// "upgrades" as we get narrower.
		let prevScore = Number.MAX_SAFE_INTEGER;
		for (let w = RESOURCE_MONITOR_MAX_WIDTH + 20; w >= 0; w--) {
			const l = computeResourceMonitorLayout(w);
			const score = (l.showMemory ? 1000 : 0) + l.graphWidth;
			expect(score).toBeLessThanOrEqual(prevScore);
			prevScore = score;
		}
	});
});

describe('ConsoleResourceMonitor', () => {
	const showContextMenu = vi.fn<(delegate: IContextMenuDelegate) => void>();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IContextMenuService, { showContextMenu })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const sampleData: ILanguageRuntimeResourceUsage[] = [{
		cpu_percent: 42,
		memory_bytes: 256 * 1024 * 1024,
		thread_count: 1,
		sampling_period_ms: 1000,
		timestamp: 0,
	}];

	it('right-click offers a checked toggle that hides the monitor', () => {
		const configurationService = ctx.get(IConfigurationService);
		const updateValue = vi.spyOn(configurationService, 'updateValue');

		rtl.render(<ConsoleResourceMonitor data={sampleData} />);

		// The monitor exposes itself as an image with a descriptive label.
		const monitor = screen.getByRole('img', { name: /resource monitor/i });
		fireEvent.contextMenu(monitor);

		// The context menu was shown; pull the toggle action out of the delegate.
		expect(showContextMenu).toHaveBeenCalledTimes(1);
		const delegate = showContextMenu.mock.calls[0][0];
		const actions = delegate.getActions() as IAction[];
		expect(actions).toHaveLength(1);
		expect(actions[0].checked).toBe(true);

		// Running it disables the setting.
		actions[0].run();
		expect(updateValue).toHaveBeenCalledWith('console.showResourceMonitor', false);
	});
});

describe('showResourceMonitorContextMenu', () => {
	const showContextMenu = vi.fn<(delegate: IContextMenuDelegate) => void>();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IContextMenuService, { showContextMenu })
		.build();

	it('offers an unchecked toggle that re-shows the monitor when hidden', () => {
		const updateValue = vi.spyOn(ctx.get(IConfigurationService), 'updateValue');

		// currentlyVisible=false: the toggle is unchecked and enables the setting.
		showResourceMonitorContextMenu(ctx.reactServices, 10, 20, false);

		expect(showContextMenu).toHaveBeenCalledTimes(1);
		const delegate = showContextMenu.mock.calls[0][0];
		const actions = delegate.getActions() as IAction[];
		expect(actions).toHaveLength(1);
		expect(actions[0].checked).toBe(false);

		actions[0].run();
		expect(updateValue).toHaveBeenCalledWith('console.showResourceMonitor', true);
	});
});
