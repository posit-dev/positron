/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { DarkFilter, IPositronPlotClient, IPositronPlotsService, ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { PlotSizingPolicyAuto } from '../../../../services/positronPlots/common/sizingPolicyAuto.js';
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';
import { PlotsContainer } from '../../browser/components/plotsContainer.js';
import { PositronPlotsContextProvider, usePositronPlotsContext } from '../../browser/positronPlotsContext.js';

/**
 * The origin-file button in the plot info header is driven by
 * `metadata.origin`, which for R plots arrives asynchronously: the plots
 * service registers (and selects) the plot first, then fills in `origin` when
 * the backend's `get_metadata` reply lands and fires `onDidUpdatePlotMetadata`.
 * These tests cover the two orderings of that reply relative to React's work
 * for the newly selected plot.
 */
describe('PlotsContainer origin file button', () => {
	const originUri = 'file:///tmp/vscsmoke/test-files/plot-attribution-test.R';

	// Describe-level emitters: the stub captures `.event` at build() time.
	const onDidEmitPlot = new Emitter<IPositronPlotClient>();
	const onDidSelectPlot = new Emitter<string>();
	const onDidUpdatePlotMetadata = new Emitter<string>();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPlotsService, {
			positronPlotInstances: [],
			selectedPlotId: undefined,
			onDidEmitPlot: onDidEmitPlot.event,
			onDidSelectPlot: onDidSelectPlot.event,
			onDidUpdatePlotMetadata: onDidUpdatePlotMetadata.event,
			onDidRemovePlot: Event.None,
			onDidReplacePlots: Event.None,
			onDidChangeSizingPolicy: Event.None,
			selectedSizingPolicy: new PlotSizingPolicyAuto(),
			setPlotsRenderSettings: vi.fn(),
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	/** A plot whose metadata has not yet been filled in by the backend. */
	function createPlot(): IPositronPlotClient {
		return ctx.disposables.add(StaticPlotClient.fromMetadata(ctx.get(IStorageService), {
			id: 'plot-2',
			created: Date.now(),
			session_id: 'session-1',
			code: 'source("plot-attribution-test.R")',
			language: 'r',
			name: 'plot 2',
			suggested_file_name: 'plot-2',
			zoom_level: ZoomLevel.Fit,
		}, 'image/png', encodeBase64(VSBuffer.fromString('fake-png-bytes'))));
	}

	/** What the plots service does when the backend's get_metadata reply arrives. */
	function deliverMetadata(plot: IPositronPlotClient) {
		plot.metadata.origin = { uri: originUri };
		onDidUpdatePlotMetadata.fire(plot.id);
	}

	/**
	 * Runs `pending` from a layout effect, i.e. in React's commit phase: after
	 * the DOM for this commit exists, but before any `useEffect` from the same
	 * commit has run. That is the window a get_metadata reply falls into when it
	 * arrives after React has committed the newly selected plot but before
	 * PlotsContainer's effects have re-run for it. Reading the context makes
	 * this component re-render, and so re-run the effect, on the same commits
	 * as PlotsContainer.
	 */
	let pending: (() => void) | undefined;
	const RunAfterCommit = () => {
		usePositronPlotsContext();
		useLayoutEffect(() => {
			const run = pending;
			pending = undefined;
			run?.();
		});
		return null;
	};

	function renderContainer() {
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
				<RunAfterCommit />
			</PositronPlotsContextProvider>
		);
	}

	it('shows the origin file when the metadata reply arrives after the plot has rendered', () => {
		const plot = createPlot();
		renderContainer();

		act(() => {
			onDidEmitPlot.fire(plot);
			onDidSelectPlot.fire(plot.id);
		});
		expect(screen.queryByRole('button', { name: 'plot-attribution-test.R' })).not.toBeInTheDocument();

		act(() => deliverMetadata(plot));
		expect(screen.getByRole('button', { name: 'plot-attribution-test.R' })).toBeInTheDocument();
	});

	it('shows the origin file when the metadata reply lands between the plot commit and its effects', () => {
		const plot = createPlot();
		renderContainer();

		act(() => {
			pending = () => deliverMetadata(plot);
			onDidEmitPlot.fire(plot);
			onDidSelectPlot.fire(plot.id);
		});

		// The reply was delivered in that window; the button must reflect it.
		expect(plot.metadata.origin?.uri).toBe(originUri);
		expect(screen.getByRole('button', { name: 'plot-attribution-test.R' })).toBeInTheDocument();
	});
});
