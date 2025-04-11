/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { ProgressBar } from '../../../../../base/browser/ui/progressbar/progressbar.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { PanZoomImage } from './panZoomImage.js';
import { ZoomLevel } from './zoomPlotMenuButton.js';
import { usePositronPlotsContext } from '../positronPlotsContext.js';
import { PlotClientInstance, PlotClientState } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PlotSizingPolicyAuto } from '../../../../services/positronPlots/common/sizingPolicyAuto.js';
import { PlotSizingPolicyIntrinsic } from '../../../../services/positronPlots/common/sizingPolicyIntrinsic.js';

/**
 * DynamicPlotInstanceProps interface.
 */
interface DynamicPlotInstanceProps {
	width: number;
	height: number;
	zoom: ZoomLevel;
	plotClient: PlotClientInstance;
}

/**
 * DynamicPlotInstance component. This component renders a single dynamic plot
 * in the Plots pane.
 *
 * Unlike a StaticPlotInstance, a DynamicPlotInstance can redraw itself when
 * the plot size changes. It wraps a PlotClientInstance, which is responsible
 * for generating the plot data.
 *
 * @param props A DynamicPlotInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const DynamicPlotInstance = (props: DynamicPlotInstanceProps) => {

	const [uri, setUri] = useState('');
	const [error, setError] = useState('');
	const progressRef = React.useRef<HTMLDivElement>(null);
	const plotsContext = usePositronPlotsContext();

	useEffect(() => {
		const ratio = DOM.getActiveWindow().devicePixelRatio;
		const disposables = new DisposableStore();

		// If the plot is already rendered, use the old image until the new one is ready.
		if (props.plotClient.lastRender) {
			setUri(props.plotClient.lastRender.uri);
		}

		// Request a plot render at the current viewport size, using a given sizing policy.
		const render = async (policy: IPositronPlotSizingPolicy) => {
			let plotSize = policy.getPlotSize({
				height: props.height,
				width: props.width
			});

			try {
				const intrinsicSize = await props.plotClient.getIntrinsicSize();

				// If using the intrinsic sizing policy, and the plot has no intrinsic size,
				// fall back to the auto sizing policy.
				if (policy instanceof PlotSizingPolicyIntrinsic && !intrinsicSize) {
					plotsContext.positronPlotsService.selectSizingPolicy(PlotSizingPolicyAuto.ID);
					plotSize = plotsContext.positronPlotsService.selectedSizingPolicy.getPlotSize({
						height: props.height,
						width: props.width
					});
				}

				// Wait for the plot to render.
				const result =
					await props.plotClient.renderWithSizingPolicy(plotSize, ratio);

				// Update the URI to the URI of the new plot.
				setUri(result.uri);

			} catch (e) {
				if (e.name === 'Canceled' || e.message === 'Canceled') {
					return;
				}
				const message = localize('positronPlots.policyRenderError', "Error rendering plot to '{0}' size: {1} ({2})", policy.getName(props.plotClient), e.message, e.code);
				plotsContext.notificationService.warn(message);
				setError(message);
			}
		};

		// Render using the current sizing policy.
		render(props.plotClient.sizingPolicy);

		// When the plot is rendered, update the URI.
		disposables.add(props.plotClient.onDidCompleteRender((result) => {
			setUri(result.uri);
		}));

		// Re-render if the sizing policy changes.
		disposables.add(props.plotClient.onDidChangeSizingPolicy((policy) => {
			render(policy);
		}));

		let progressBar: ProgressBar | undefined;
		let progressTimer: number | undefined;

		// Wait for the plot to render, and show a progress bar.
		disposables.add(props.plotClient.onDidChangeState((state) => {

			// No work to do if we don't have a progress bar.
			if (!progressRef.current) {
				return;
			}

			const activeWindow = DOM.getActiveWindow();

			// If we're rendering, show a progress bar.
			if (state === PlotClientState.Rendering) {
				// Before starting a new render, remove any existing progress bars. This prevents
				// a buildup of progress bars when rendering multiple times and ensures the progress bar
				// is removed when a new render is requested before the previous one completes.
				progressRef.current.replaceChildren();

				// Create the progress bar.
				progressBar = new ProgressBar(progressRef.current);

				if (props.plotClient.renderEstimateMs > 0) {
					// If the plot has previously rendered, then it knows about
					// how long it will take to render. Use that to set the
					// progress bar; consider each millisecond to be one unit of work
					// to be done.
					const started = Date.now();
					progressBar.total(props.plotClient.renderEstimateMs);
					progressTimer = activeWindow.setInterval(() => {
						// Every 100ms, update the progress bar.
						progressBar?.setWorked(Date.now() - started);
					}, 100);
				} else {
					// If the plot has never rendered before, then it doesn't
					// know how long it will take to render. Just show an
					// infinite progress bar.
					progressBar.infinite();
				}
			} else if (state === PlotClientState.Rendered || state === PlotClientState.Closed) {
				// When the render completes, clean up the progress bar and
				// timers if they exist.
				if (progressTimer) {
					activeWindow.clearTimeout(progressTimer);
					progressTimer = undefined;
				}
				if (progressBar) {
					progressBar.done();
					progressBar.dispose();
					progressBar = undefined;
				}
			}
		}));
		return () => {
			disposables.dispose();
		};
	}, [props.plotClient, props.height, props.width, plotsContext.positronPlotsService, plotsContext.notificationService]);

	// Render method for the plot image.
	const renderedImage = () => {
		return <PanZoomImage
			description={props.plotClient.metadata.code ?
				props.plotClient.metadata.code :
				'Plot ' + props.plotClient.id}
			height={props.height}
			imageUri={uri}
			width={props.width}
			zoom={props.zoom}
		/>;
	};

	// Render method for the placeholder
	const placeholderImage = (text: string) => {
		const style = {
			width: props.width + 'px',
			height: props.height + 'px'
		};

		text = text.length ? text : `Rendering plot`;

		// display error here
		return <div className='image-placeholder' style={style}>
			<div className='image-placeholder-text'>
				{text}
			</div>
		</div>;
	};

	// If the plot is not yet rendered yet (no URI), show a placeholder;
	// otherwise, show the rendered plot.
	return (
		<div className='plot-instance dynamic-plot-instance'>
			<div ref={progressRef}></div>
			{uri && renderedImage()}
			{!uri && placeholderImage(error)}
		</div>
	);
};
