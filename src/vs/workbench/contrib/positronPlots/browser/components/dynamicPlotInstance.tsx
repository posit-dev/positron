/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import * as DOM from 'vs/base/browser/dom';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { PanZoomImage } from 'vs/workbench/contrib/positronPlots/browser/components/panZoomImage';
import { ZoomLevel } from 'vs/workbench/contrib/positronPlots/browser/components/zoomPlotMenuButton';
import { usePositronPlotsContext } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsContext';
import { PlotClientInstance, PlotClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';

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
	const [plotSize, setPlotSize] = useState({ height: props.height, width: props.width });
	const progressRef = React.useRef<HTMLDivElement>(null);
	const plotsContext = usePositronPlotsContext();

	useEffect(() => {
		const ratio = DOM.getActiveWindow().devicePixelRatio;
		const ratio = DOM.getActiveWindow().devicePixelRatio;
		const disposables = new DisposableStore();

		// If the plot is already rendered, use the old image until the new one is ready.
		if (props.plotClient.lastRender) {
			setUri(props.plotClient.lastRender.uri);
		}

		// Request a plot render at the current size, using the current sizing policy.
		let newPlotSize: IPlotSize | undefined;
		props.plotClient.getIntrinsicSize().then((intrinsicSize) => {
			newPlotSize = plotsContext.positronPlotsService.selectedSizingPolicy.getPlotSize({
				height: props.height,
				width: props.width
			});
			// TODO: Handle null case
			setPlotSize(newPlotSize ?? { width: 100, height: 100 });
			return props.plotClient.render(newPlotSize, ratio);
		}).then((result) => {
			setUri(result.uri);
		}).catch((e) => {
			// It's normal for a plot render to be canceled if the user invalidates the render
			// by e.g. changing the plot size or the sizing policy while render
			// is active. Don't show a warning in that case.
			if (e.name === 'Canceled' || e.message === 'Canceled') {
				return;
			}
			const message = localize('positronPlots.renderError', "Error rendering plot to {0} x {1}: {2} ({3})", newPlotSize?.width, newPlotSize?.height, e.message, e.code);
			plotsContext.notificationService.warn(message);
			setError(message);
		});

		// When the plot is rendered, update the URI.
		disposables.add(props.plotClient.onDidCompleteRender((result) => {
			setUri(result.uri);
		}));

		// Re-render if the sizing policy changes.
		disposables.add(plotsContext.positronPlotsService.onDidChangeSizingPolicy(async (policy) => {
			const newPlotSize = policy.getPlotSize({
				height: props.height,
				width: props.width
			});
			setPlotSize(newPlotSize ?? { width: 100, height: 100 });

			try {
				// Wait for the plot to render.
				const result =
					await props.plotClient.render(newPlotSize, ratio);

				// Update the URI to the URI of the new plot.
				setUri(result.uri);

			} catch (e) {
				if (e.name === 'Canceled' || e.message === 'Canceled') {
					return;
				}
				const message = localize('positronPlots.policyRenderError', "Error rendering plot to '{0}' size: {1} ({2})", policy.name, e.message, e.code);
				plotsContext.notificationService.warn(message);
			}
		}));

		let progressBar: ProgressBar | undefined;
		let progressTimer: number | undefined;

		// Wait for the plot to render, and show a progress bar.
		disposables.add(props.plotClient.onDidChangeState((state) => {

			// No work to do if we don't have a progress bar.
			if (!progressRef.current) {
				return;
			}

			// If we're rendering, show a progress bar.
			if (state === PlotClientState.Rendering) {
				// Create the progress bar.
				progressBar = new ProgressBar(progressRef.current);

				if (props.plotClient.renderEstimateMs > 0) {
					// If the plot has previously rendered, then it knows about
					// how long it will take to render. Use that to set the
					// progress bar; consider each millisecond to be one unit of work
					// to be done.
					const started = Date.now();
					progressBar.total(props.plotClient.renderEstimateMs);
					progressTimer = DOM.getActiveWindow().setInterval(() => {
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
					DOM.getActiveWindow().clearTimeout(progressTimer);
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
			imageUri={uri}
			description={props.plotClient.metadata.code ?
				props.plotClient.metadata.code :
				'Plot ' + props.plotClient.id}
			zoom={props.zoom}
			width={props.width}
			height={props.height}
		/>;
	};

	// Render method for the placeholder
	const placeholderImage = (text: string) => {
		const style = {
			width: props.width + 'px',
			height: props.height + 'px'
		};

		text = text.length ? text : `Rendering plot (${plotSize.width} x ${plotSize.height})`;

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
