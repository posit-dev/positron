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
import { ConsoleResourceMonitor, computeResourceMonitorLayout, RESOURCE_MONITOR_MAX_WIDTH } from '../../browser/components/consoleResourceMonitor.js';

describe('computeResourceMonitorLayout', () => {
	it('shows nothing when there is no room', () => {
		expect(computeResourceMonitorLayout(0)).toEqual({
			showCpu: false,
			showMemory: false,
			showLabels: false,
			graphWidth: 0,
		});
		expect(computeResourceMonitorLayout(20)).toEqual({
			showCpu: false,
			showMemory: false,
			showLabels: false,
			graphWidth: 0,
		});
	});

	it('shows the CPU value only when narrow', () => {
		const layout = computeResourceMonitorLayout(40);
		expect(layout.showCpu).toBe(true);
		expect(layout.showMemory).toBe(false);
		expect(layout.showLabels).toBe(false);
		expect(layout.graphWidth).toBe(0);
	});

	it('shows both values without a graph when slightly wider', () => {
		const layout = computeResourceMonitorLayout(110);
		expect(layout.showCpu).toBe(true);
		expect(layout.showMemory).toBe(true);
		expect(layout.showLabels).toBe(false);
		expect(layout.graphWidth).toBe(0);
	});

	it('adds a graph that grows with available width but stays below the labels threshold', () => {
		const layout = computeResourceMonitorLayout(220);
		expect(layout.showCpu).toBe(true);
		expect(layout.showMemory).toBe(true);
		expect(layout.showLabels).toBe(false);
		expect(layout.graphWidth).toBeGreaterThanOrEqual(50);
		expect(layout.graphWidth).toBeLessThanOrEqual(150);
	});

	it('shows labels and a full-width graph at the maximum width', () => {
		const layout = computeResourceMonitorLayout(RESOURCE_MONITOR_MAX_WIDTH);
		expect(layout).toEqual({
			showCpu: true,
			showMemory: true,
			showLabels: true,
			graphWidth: 150,
		});
	});

	it('drops labels before shrinking the graph as width decreases', () => {
		// Just below the max width, labels are dropped but the graph stays wide.
		const layout = computeResourceMonitorLayout(RESOURCE_MONITOR_MAX_WIDTH - 1);
		expect(layout.showLabels).toBe(false);
		expect(layout.showCpu).toBe(true);
		expect(layout.showMemory).toBe(true);
		expect(layout.graphWidth).toBe(150);
	});

	it('degrades monotonically as width shrinks', () => {
		// Walk widths from wide to narrow and assert the feature set never
		// "upgrades" as we get narrower.
		let prevScore = Number.MAX_SAFE_INTEGER;
		for (let w = RESOURCE_MONITOR_MAX_WIDTH + 20; w >= 0; w--) {
			const l = computeResourceMonitorLayout(w);
			const score =
				(l.showLabels ? 1000 : 0) +
				l.graphWidth +
				(l.showMemory ? 100 : 0) +
				(l.showCpu ? 10 : 0);
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
