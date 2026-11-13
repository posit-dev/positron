/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { Event } from '../../../../../base/common/event.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronPlots } from '../../browser/positronPlots.js';
import { isZoomablePlotClient, ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { RuntimeClientType } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';

// happy-dom has no canvas, so the real dynamic action bar renders nothing. Render
// each left action's component directly instead.
vi.mock(import('../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js'), async importOriginal => {
	const actual = await importOriginal();
	return {
		...actual,
		PositronDynamicActionBar: (props: Parameters<typeof actual.PositronDynamicActionBar>[0]) => (
			<div>{props.leftActions?.map((action, index) => <span key={index}>{typeof action.component === 'function' ? <action.component /> : action.component}</span>)}</div>
		),
	};
});

describe('Plot zoom state', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const reactComponentContainer: IReactComponentContainer = {
		width: 800,
		height: 600,
		containerVisible: true,
		takeFocus: () => { },
		onFocused: Event.None,
		onSizeChanged: Event.None,
		onPositionChanged: Event.None,
		onVisibilityChanged: Event.None,
		onSaveScrollPosition: Event.None,
		onRestoreScrollPosition: Event.None,
	};

	/**
	 * Sets the zoom level of a plot, as choosing a level in the Zoom dropdown does.
	 */
	function setPlotZoom(plotId: string, zoomLevel: ZoomLevel) {
		const plot = ctx.reactServices.positronPlotsService.positronPlotInstances.find(p => p.id === plotId);
		if (!isZoomablePlotClient(plot)) {
			throw new Error(`Plot ${plotId} is not zoomable`);
		}
		act(() => {
			plot.zoomLevel = zoomLevel;
		});
	}

	it('shows the new zoom level when a plot selected before the pane mounted is zoomed', async () => {
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		expect(ctx.reactServices.positronPlotsService.selectedPlotId).toBe('plot1');

		// Mount the pane after the plot was already selected.
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);
		expect(screen.getByRole('button', { name: /Fit/ })).toBeInTheDocument();

		setPlotZoom('plot1', ZoomLevel.TwoHundred);

		expect(screen.getByRole('button', { name: /200%/ })).toBeInTheDocument();
	});

	it('ignores zoom changes of a plot that is no longer selected', async () => {
		const plotsService = ctx.reactServices.positronPlotsService;
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot2');
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);

		// Select the first plot, then move to the second so the first is deselected.
		act(() => plotsService.selectPlot('plot1'));
		act(() => plotsService.selectPlot('plot2'));
		expect(screen.getByRole('button', { name: /Fit/ })).toBeInTheDocument();

		setPlotZoom('plot1', ZoomLevel.TwoHundred);

		expect(screen.getByRole('button', { name: /Fit/ })).toBeInTheDocument();
	});

	it('shows the zoom level of the newly selected plot', async () => {
		const plotsService = ctx.reactServices.positronPlotsService;
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot2');
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);

		setPlotZoom('plot2', ZoomLevel.Fifty);
		expect(screen.getByRole('button', { name: /50%/ })).toBeInTheDocument();

		act(() => plotsService.selectPlot('plot1'));

		expect(screen.getByRole('button', { name: /Fit/ })).toBeInTheDocument();
	});

	it('shows the zoom level of the plot selected after the selected plot is removed', async () => {
		const plotsService = ctx.reactServices.positronPlotsService;
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot2');
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);
		setPlotZoom('plot2', ZoomLevel.TwoHundred);
		expect(screen.getByRole('button', { name: /200%/ })).toBeInTheDocument();

		act(() => plotsService.removePlot('plot2'));

		expect(plotsService.selectedPlotId).toBe('plot1');
		expect(screen.getByRole('button', { name: /Fit/ })).toBeInTheDocument();
	});
});
