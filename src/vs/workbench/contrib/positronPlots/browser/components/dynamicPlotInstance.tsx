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
import { isCancellationError } from '../../../../../base/common/errors.js';
import { localize } from '../../../../../nls.js';
import Severity from '../../../../../base/common/severity.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { PanZoomImage } from './panZoomImage.js';
import { PlotClientInstance, PlotClientState } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PlotSizingPolicyCustom } from '../../../../services/positronPlots/common/sizingPolicyCustom.js';
import { ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { showWindowLogActionId } from '../../../../services/log/common/logConstants.js';

// Errors R raises when the plot area is too small for the plot's margins (#8049).
// R reported these in English under every language tried (de, fr, ja, es).
const PLOT_TOO_SMALL_ERRORS = [
	'invalid graphics state',
	'figure margins too large',
	'figure region too large',
	'plot region too large',
];

const isPlotTooSmallError = (message: string) =>
	PLOT_TOO_SMALL_ERRORS.some(error => message.includes(error));

/**
 * A failed render: whether it failed because the plot area is too small.
 */
interface RenderError {
	tooSmall: boolean;
	// Set for a custom size, which ignores the pane size, so enlarging the pane won't help.
	customSize?: string;
}

/**
 * The message for a failed render. The popup names the size the user picked.
 */
const renderErrorMessage = (error: RenderError, pickedSize?: string) => {
	if (!error.tooSmall) {
		return pickedSize === undefined ?
			localize('positronPlots.renderError', "Couldn't render this plot.") :
			localize('positronPlots.renderErrorAtPolicy', "Couldn't render this plot at the '{0}' size.", pickedSize);
	}
	if (error.customSize !== undefined) {
		return localize('positronPlots.renderTooSmallAtCustomSize', "Couldn't render this plot at the '{0}' size because it's too small. Choose a larger size from the sizing menu.", error.customSize);
	}
	return pickedSize === undefined ?
		localize('positronPlots.renderTooSmall', "Couldn't render this plot because the plot area is too small. Try making it larger.") :
		localize('positronPlots.renderTooSmallAtPolicy', "Couldn't render this plot at the '{0}' size because the plot area is too small.", pickedSize);
};

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

	const services = usePositronReactServicesContext();
	const [uri, setUri] = useState('');
	const [error, setError] = useState<RenderError | undefined>(undefined);
	const progressRef = React.useRef<HTMLDivElement>(null);
	const plotName = props.plotClient.metadata.name ? props.plotClient.metadata.name : 'Plot ' + props.plotClient.id;

	useEffect(() => {
		const ratio = DOM.getActiveWindow().devicePixelRatio;
		const disposables = new DisposableStore();
		let disposed = false;

		// The frontend shoudn't send invalid sizes so be defensive. Sometimes the
		// plot container is in a strange state when it's hidden.
		if (props.height <= 0 || props.width <= 0) {
			return;
		}

		// Clear any message from an earlier size; this render may succeed.
		setError(undefined);

		// If the plot is already rendered, use the old image until the new one is ready.
		if (props.plotClient.lastRender) {
			setUri(props.plotClient.lastRender.uri);
		}

		// Request a plot render at the current viewport size, using a given sizing policy.
		const render = async (policy: IPositronPlotSizingPolicy, reportErrors = false) => {
			const viewportSize = { height: props.height, width: props.width };
			try {
				// Intrinsic returns no size; pass the viewport so a plot with no size of its own can fall back to Auto.
				const result = await props.plotClient.renderWithSizingPolicy(policy.getPlotSize(viewportSize) ?? viewportSize, ratio);

				// Update the URI to the URI of the new plot.
				setUri(result.uri);

			} catch (e) {
				// A render from an earlier size or plot finished after we moved on.
				if (disposed || isCancellationError(e)) {
					return;
				}
				// Renders run on every resize, so log instead of notifying.
				const policyName = policy.getName(props.plotClient);
				services.logService.warn(`Error rendering plot to '${policyName}' size: ${e.message}${e.code !== undefined ? ` (${e.code})` : ''}`);
				const renderError: RenderError = {
					tooSmall: isPlotTooSmallError(String(e.message)),
					customSize: policy instanceof PlotSizingPolicyCustom ? policyName : undefined,
				};
				setError(renderError);
				// Resizing the pane can't fix a custom size, so drop the old image to show the message.
				if (renderError.customSize !== undefined) {
					setUri('');
				}
				// A sizing change is usually picked by the user, and the old image
				// would hide the failure, so tell them.
				if (reportErrors && props.plotClient.lastRender) {
					services.notificationService.prompt(Severity.Warning, renderErrorMessage(renderError, policyName), [{
						label: localize('positronPlots.showLogs', "Show Logs"),
						run: () => services.commandService.executeCommand(showWindowLogActionId)
					}]);
				}
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
			render(policy, true);
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
			disposed = true;
			disposables.dispose();
		};
	}, [props.plotClient, props.height, props.width, services.logService, services.notificationService, services.commandService]);

	// Render method for the plot image.
	const renderedImage = () => {
		return <PanZoomImage
			description={plotName}
			height={props.height}
			imageUri={uri}
			width={props.width}
			zoom={props.zoom}
		/>;
	};

	// Render method for the placeholder, which shows progress or the render error.
	const placeholderImage = () => {
		const style = {
			width: props.width + 'px',
			height: props.height + 'px'
		};

		if (!error) {
			return <div className='image-placeholder' style={style}>
				<div className='image-placeholder-text'>Rendering plot</div>
			</div>;
		}

		const text = renderErrorMessage(error);
		return <div className='image-placeholder' style={style}>
			<div className='image-placeholder-text'>{text}</div>
			<Button
				className='image-placeholder-link'
				onPressed={() => services.commandService.executeCommand(showWindowLogActionId)}
			>
				{localize('positronPlots.showLogs', "Show Logs")}
			</Button>
		</div>;
	};

	// If the plot is not yet rendered yet (no URI), show a placeholder;
	// otherwise, show the rendered plot.
	return (
		<div className='plot-instance dynamic-plot-instance'>
			<div ref={progressRef}></div>
			{/* Scrollable moves its element out of React's tree, so give React a wrapper it can remove. */}
			{uri && <div style={{ display: 'contents' }}>{renderedImage()}</div>}
			{!uri && placeholderImage()}
		</div>
	);
};
