/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IPlotLocator } from '../../../../services/positronPlots/common/plotLocator.js';
import { DarkFilter, IPositronPlotClient, IPositronPlotsService, ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { PlotSizingPolicyAuto } from '../../../../services/positronPlots/common/sizingPolicyAuto.js';
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';
import { PlotsContainer } from '../../browser/components/plotsContainer.js';
import { PositronPlotsContextProvider } from '../../browser/positronPlotsContext.js';

const PLOT_ID = 'plot-2';
const SESSION_ID = 'session-1';

/**
 * In the Plots pane, the locator prompt replaces the plot name in the plot info header, so the
 * plot keeps its full height.
 */
describe('PlotsContainer locator prompt', () => {
	// Describe-level emitters: the stub captures `.event` at build() time.
	const onDidEmitPlot = new Emitter<IPositronPlotClient>();
	const onDidSelectPlot = new Emitter<string>();
	const onDidChangeLocator = new Emitter<IPlotLocator | undefined>();
	const resolveLocator = vi.fn<IPositronPlotsService['resolveLocator']>();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPlotsService, {
			positronPlotInstances: [],
			selectedPlotId: undefined,
			activeLocator: undefined,
			onDidChangeLocator: onDidChangeLocator.event,
			resolveLocator,
			onDidEmitPlot: onDidEmitPlot.event,
			onDidSelectPlot: onDidSelectPlot.event,
			onDidUpdatePlotMetadata: Event.None,
			onDidRemovePlot: Event.None,
			onDidReplacePlots: Event.None,
			onDidChangeSizingPolicy: Event.None,
			selectedSizingPolicy: new PlotSizingPolicyAuto(),
			setPlotsRenderSettings: vi.fn(),
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	afterAll(() => {
		onDidEmitPlot.dispose();
		onDidSelectPlot.dispose();
		onDidChangeLocator.dispose();
	});

	/** Renders the container with one selected plot named "plot 2". */
	function renderWithPlot() {
		const plot = ctx.disposables.add(StaticPlotClient.fromMetadata(ctx.get(IStorageService), {
			id: PLOT_ID,
			created: Date.now(),
			session_id: SESSION_ID,
			code: 'plot(1:10)',
			language: 'r',
			name: 'plot 2',
			suggested_file_name: 'plot-2',
			zoom_level: ZoomLevel.Fit,
		}, 'image/png', encodeBase64(VSBuffer.fromString('fake-png-bytes'))));

		rtl.render(
			<PositronPlotsContextProvider>
				<PlotsContainer
					darkFilterMode={DarkFilter.Off}
					height={400}
					showHistory={false}
					visible={true}
					width={600}
					x={0}
					y={0}
				/>
			</PositronPlotsContextProvider>
		);
		act(() => {
			onDidEmitPlot.fire(plot);
			onDidSelectPlot.fire(plot.id);
		});
	}

	function startLocator(plotId = PLOT_ID) {
		act(() => onDidChangeLocator.fire({ sessionId: SESSION_ID, plotId, size: { width: 400, height: 300 } }));
	}

	it('shows the prompt in place of the plot name while a locator waits on the plot', () => {
		renderWithPlot();
		expect(screen.getByText('plot 2')).toBeInTheDocument();

		startLocator();
		expect(screen.getByRole('status')).toHaveTextContent('Click the plot to choose a point.');
		expect(screen.queryByText('plot 2')).not.toBeInTheDocument();

		act(() => onDidChangeLocator.fire(undefined));
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
		expect(screen.getByText('plot 2')).toBeInTheDocument();
	});

	it('shows no prompt when the locator waits on another plot', () => {
		renderWithPlot();
		startLocator('other-plot');
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
		expect(screen.getByText('plot 2')).toBeInTheDocument();
	});

	it('finishes the locator when Finish is clicked', async () => {
		const user = userEvent.setup();
		renderWithPlot();
		startLocator();
		await user.click(screen.getByRole('button', { name: 'Finish' }));
		expect(resolveLocator.mock.calls).toEqual([[undefined]]);
	});
});
