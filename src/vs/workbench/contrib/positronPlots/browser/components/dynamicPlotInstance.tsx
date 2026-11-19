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
import { PLOT_LOCATOR_BANNER_HEIGHT, PlotLocatorBanner } from './plotLocatorBanner.js';
import { PlotClientInstance, PlotClientState } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IRenderedPlot } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { IPlotSize, IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PlotSizingPolicyCustom } from '../../../../services/positronPlots/common/sizingPolicyCustom.js';
import { arePointsForPlot, IPlotLocator, IPlotLocatorPoints, isLocatorForPlot } from '../../../../services/positronPlots/common/plotLocator.js';
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
 * Returns the element that takes the focus when the locator mode ends: the closest focusable
 * ancestor of the plot instance, such as the Plots pane or the plot editor.
 */
function focusTargetOf(wrapper: HTMLElement): HTMLElement | null {
	return wrapper.parentElement?.closest<HTMLElement>('[tabindex]') ?? null;
}

/**
 * DynamicPlotInstanceProps interface.
 */
interface DynamicPlotInstanceProps {
	width: number;
	height: number;
	zoom: ZoomLevel;
	plotClient: PlotClientInstance;
	/**
	 * Whether to show the locator prompt in a banner above the plot. The Plots pane shows it in
	 * its plot info header instead. Defaults to true.
	 */
	showLocatorBanner?: boolean;
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
	// The size of the image at `uri`, in logical pixels, if known.
	const [uriSize, setUriSize] = useState<IPlotSize | undefined>(undefined);
	const [error, setError] = useState<RenderError | undefined>(undefined);
	const progressRef = React.useRef<HTMLDivElement>(null);
	// The render effect's callbacks outlive a render, so they read the shown image from here.
	const uriRef = React.useRef(uri);
	useEffect(() => {
		uriRef.current = uri;
	}, [uri]);
	const wrapperRef = React.useRef<HTMLDivElement>(null);
	const plotId = props.plotClient.id;
	const sessionId = props.plotClient.metadata.session_id;
	// The locator() call waiting on this plot, if any.
	const [locator, setLocator] = useState<IPlotLocator | undefined>(() => {
		const active = services.positronPlotsService.activeLocator;
		return isLocatorForPlot(active, sessionId, plotId) ? active : undefined;
	});
	const locating = locator !== undefined;
	// The points chosen on this plot so far, shown as markers.
	const [locatorPoints, setLocatorPoints] = useState<IPlotLocatorPoints | undefined>(() => {
		const points = services.positronPlotsService.locatorPoints;
		return arePointsForPlot(points, sessionId, plotId) ? points : undefined;
	});
	const showBanner = locating && props.showLocatorBanner !== false;

	// Whether the wrapper had focus when the locator mode last ended. locator() and identify()
	// send one request per point, so the next request for this plot takes the focus back and
	// Escape keeps working.
	const restoreFocusRef = React.useRef(false);

	// Track whether a locator() call is waiting on this plot. A new locator request fires an
	// intermediate undefined before the new locator, which is harmless here.
	useEffect(() => {
		// Catch a locator that started between the first render and this subscription.
		const active = services.positronPlotsService.activeLocator;
		setLocator(isLocatorForPlot(active, sessionId, plotId) ? active : undefined);
		const disposable = services.positronPlotsService.onDidChangeLocator(locator => {
			const wrapper = wrapperRef.current;
			if (isLocatorForPlot(locator, sessionId, plotId)) {
				setLocator(locator);
				return;
			}
			if (locator) {
				// A locator for another plot.
				restoreFocusRef.current = false;
			} else if (wrapper && wrapper.contains(wrapper.ownerDocument.activeElement)) {
				// The wrapper stops being focusable when the mode ends. Move the focus to the
				// Plots pane or editor before that happens, so it does not fall to the document
				// body.
				restoreFocusRef.current = true;
				focusTargetOf(wrapper)?.focus();
			}
			setLocator(undefined);
		});
		return () => disposable.dispose();
	}, [plotId, sessionId, services.positronPlotsService]);

	// Track the points chosen on this plot.
	useEffect(() => {
		const forThisPlot = (points: IPlotLocatorPoints | undefined) =>
			arePointsForPlot(points, sessionId, plotId) ? points : undefined;
		setLocatorPoints(forThisPlot(services.positronPlotsService.locatorPoints));
		const disposable = services.positronPlotsService.onDidChangeLocatorPoints(
			points => setLocatorPoints(forThisPlot(points))
		);
		return () => disposable.dispose();
	}, [plotId, sessionId, services.positronPlotsService]);

	// Take the focus back when the next locator request for this plot starts, unless the
	// user moved the focus somewhere else in the meantime.
	useEffect(() => {
		const wrapper = wrapperRef.current;
		if (!locating || !restoreFocusRef.current || !wrapper) {
			return;
		}
		restoreFocusRef.current = false;
		const active = wrapper.ownerDocument.activeElement;
		if (!active || active === wrapper.ownerDocument.body || active === focusTargetOf(wrapper)) {
			wrapper.focus();
		}
	}, [locating]);

	const plotName = props.plotClient.metadata.name ? props.plotClient.metadata.name : 'Plot ' + props.plotClient.id;

	useEffect(() => {
		const ratio = DOM.getActiveWindow().devicePixelRatio;
		const disposables = new DisposableStore();
		let disposed = false;

		const showRender = (rendered: IRenderedPlot) => {
			setUri(rendered.uri);
			setUriSize(rendered.size);
		};

		// The frontend shoudn't send invalid sizes so be defensive. Sometimes the
		// plot container is in a strange state when it's hidden.
		if (props.height <= 0 || props.width <= 0) {
			return;
		}

		// Clear any message from an earlier size; this render may succeed.
		setError(undefined);

		// If the plot is already rendered, use the old image until the new one is
		// ready, unless it lacks the runtime's last change.
		if (props.plotClient.lastRender) {
			if (props.plotClient.lastRenderStale) {
				setUri('');
			} else {
				showRender(props.plotClient.lastRender);
			}
		}

		const showRenderError = (e: any, policy: IPositronPlotSizingPolicy, reportErrors: boolean) => {
			// Renders run on every resize, so log instead of notifying.
			const policyName = policy.getName(props.plotClient);
			services.logService.warn(`Error rendering plot to '${policyName}' size: ${e.message}${e.code !== undefined ? ` (${e.code})` : ''}`);
			const renderError: RenderError = {
				tooSmall: isPlotTooSmallError(String(e.message)),
				customSize: policy instanceof PlotSizingPolicyCustom ? policyName : undefined,
			};
			setError(renderError);
			if (renderError.customSize !== undefined || props.plotClient.lastRenderStale || props.plotClient.lastRenderIsPreRender) {
				// Show the message, not the old image: resizing can't fix a custom size,
				// an out-of-date image would hide the user's last change, and R's first
				// image was drawn at a size this view never had.
				setUri('');
			} else if (reportErrors && uriRef.current) {
				// The user picked this size, and the old image hides the failure, so tell them.
				services.notificationService.prompt(Severity.Warning, renderErrorMessage(renderError, policyName), [{
					label: localize('positronPlots.showLogs', "Show Logs"),
					run: () => services.commandService.executeCommand(showWindowLogActionId)
				}]);
			}
		};

		// Request a plot render at the current viewport size, using a given sizing policy.
		const render = async (policy: IPositronPlotSizingPolicy, reportErrors = false) => {
			const viewportSize = { height: props.height, width: props.width };
			try {
				// Intrinsic returns no size; pass the viewport so a plot with no size of its own can fall back to Auto.
				const result = await props.plotClient.renderWithSizingPolicy(policy.getPlotSize(viewportSize) ?? viewportSize, ratio);

				// Update the URI to the URI of the new plot.
				showRender(result);

			} catch (e) {
				// A render from an earlier size or plot finished after we moved on.
				if (disposed || isCancellationError(e)) {
					return;
				}
				showRenderError(e, policy, reportErrors);
			}
		};

		// Render using the current sizing policy.
		render(props.plotClient.sizingPolicy);

		// When the plot is rendered, update the URI.
		disposables.add(props.plotClient.onDidCompleteRender((result) => {
			showRender(result);
		}));

		// An update from the runtime cancels our render, so its failure arrives here instead (#8049).
		disposables.add(props.plotClient.onDidFailRenderUpdate((e) => {
			showRenderError(e, props.plotClient.sizingPolicy, false);
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

	// The point maps to the plot only on the image the kernel sent for this request. Another
	// image, such as an older one that is still shown, takes no clicks.
	const canLocate = locator !== undefined &&
		uriSize?.width === locator.size.width &&
		uriSize.height === locator.size.height;

	// The markers are in the right place only on the image the points were chosen on.
	const pointsToMark = locatorPoints &&
		uriSize?.width === locatorPoints.size.width &&
		uriSize.height === locatorPoints.size.height ? locatorPoints.points : undefined;

	// Render method for the plot image.
	const renderedImage = () => {
		return <PanZoomImage
			description={plotName}
			height={showBanner ? Math.max(props.height - PLOT_LOCATOR_BANNER_HEIGHT, 0) : props.height}
			imageUri={uri}
			locatorPoints={pointsToMark}
			width={props.width}
			zoom={props.zoom}
			onLocate={canLocate ? point => services.positronPlotsService.resolveLocator(point) : undefined}
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
		// The wrapper is only focusable programmatically (tabIndex -1), so Escape reaches it in locator mode.
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions
		<div
			ref={wrapperRef}
			className={locating ? 'plot-instance dynamic-plot-instance locator-active' : 'plot-instance dynamic-plot-instance'}
			tabIndex={locating ? -1 : undefined}
			onKeyDown={locating ? e => {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					services.positronPlotsService.resolveLocator(undefined);
				}
			} : undefined}
			onMouseDown={locating ? () => wrapperRef.current?.focus() : undefined}
		>
			{showBanner && <PlotLocatorBanner onFinish={() => services.positronPlotsService.resolveLocator(undefined)} />}
			<div ref={progressRef}></div>
			{/* Scrollable moves its element out of React's tree, so give React a wrapper it can remove. */}
			{uri && <div style={{ display: 'contents' }}>{renderedImage()}</div>}
			{!uri && placeholderImage()}
		</div>
	);
};
