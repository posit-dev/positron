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
import { PLOT_LOCATOR_BANNER_HEIGHT, PlotLocatorBanner } from './plotLocatorBanner.js';
import { PlotClientInstance, PlotClientState } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PlotSizingPolicyAuto } from '../../../../services/positronPlots/common/sizingPolicyAuto.js';
import { PlotSizingPolicyIntrinsic } from '../../../../services/positronPlots/common/sizingPolicyIntrinsic.js';
import { IPlotLocator } from '../../../../services/positronPlots/common/plotLocator.js';
import { ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

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
	const [error, setError] = useState('');
	const progressRef = React.useRef<HTMLDivElement>(null);
	const wrapperRef = React.useRef<HTMLDivElement>(null);
	const plotId = props.plotClient.id;
	const sessionId = props.plotClient.metadata.session_id;
	const [locating, setLocating] = useState(() => {
		const locator = services.positronPlotsService.activeLocator;
		return locator?.plotId === plotId && locator.sessionId === sessionId;
	});

	// Whether the wrapper had focus when the locator mode last ended. locator() and identify()
	// send one request per point, so the next request for this plot takes the focus back and
	// Escape keeps working.
	const restoreFocusRef = React.useRef(false);

	// Track whether a locator() call is waiting on this plot. A new locator request fires an
	// intermediate undefined before the new locator, which is harmless here.
	useEffect(() => {
		const matches = (locator: IPlotLocator | undefined) =>
			locator?.plotId === plotId && locator.sessionId === sessionId;
		setLocating(matches(services.positronPlotsService.activeLocator));
		const disposable = services.positronPlotsService.onDidChangeLocator(locator => {
			const wrapper = wrapperRef.current;
			if (matches(locator)) {
				setLocating(true);
				return;
			}
			if (locator) {
				// A locator for another plot.
				restoreFocusRef.current = false;
			} else if (wrapper && wrapper.contains(wrapper.ownerDocument.activeElement)) {
				// The wrapper stops being focusable when the mode ends. Move the focus to the
				// Plots pane before that happens, so it does not fall to the document body.
				restoreFocusRef.current = true;
				wrapper.parentElement?.closest<HTMLElement>('.plots-container')?.focus();
			}
			setLocating(false);
		});
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
		const container = wrapper.parentElement?.closest('.plots-container');
		if (!active || active === wrapper.ownerDocument.body || active === container) {
			wrapper.focus();
		}
	}, [locating]);

	const plotName = props.plotClient.metadata.name ? props.plotClient.metadata.name : 'Plot ' + props.plotClient.id;

	useEffect(() => {
		const ratio = DOM.getActiveWindow().devicePixelRatio;
		const disposables = new DisposableStore();

		// The frontend shoudn't send invalid sizes so be defensive. Sometimes the
		// plot container is in a strange state when it's hidden.
		if (props.height <= 0 || props.width <= 0) {
			return;
		}

		// If the plot is already rendered, use the old image until the new one is ready.
		if (props.plotClient.lastRender) {
			setUri(props.plotClient.lastRender.uri);
		}

		// Request a plot render at the current viewport size, using a given sizing policy.
		const render = async (policy: IPositronPlotSizingPolicy, forceRerender?: boolean) => {
			let plotSize = policy.getPlotSize({
				height: props.height,
				width: props.width
			});

			try {
				const intrinsicSize = await props.plotClient.getIntrinsicSize();

				// If using the intrinsic sizing policy, and the plot has no intrinsic size,
				// fall back to the auto sizing policy.
				if (policy instanceof PlotSizingPolicyIntrinsic && !intrinsicSize) {
					services.positronPlotsService.selectSizingPolicy(PlotSizingPolicyAuto.ID);
					plotSize = services.positronPlotsService.selectedSizingPolicy.getPlotSize({
						height: props.height,
						width: props.width
					});
				}

				const result = await props.plotClient.renderWithSizingPolicy(
					plotSize,
					ratio
				);


				// Update the URI to the URI of the new plot.
				setUri(result.uri);

			} catch (e) {
				if (e.name === 'Canceled' || e.message === 'Canceled') {
					return;
				}
				const message = localize('positronPlots.policyRenderError', "Error rendering plot to '{0}' size: {1} ({2})", policy.getName(props.plotClient), e.message, e.code);
				services.notificationService.warn(message);
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
			disposables.dispose();
		};
	}, [props.plotClient, props.height, props.width, services.positronPlotsService, services.notificationService]);

	// Render method for the plot image.
	const renderedImage = () => {
		return <PanZoomImage
			description={plotName}
			height={locating ? Math.max(props.height - PLOT_LOCATOR_BANNER_HEIGHT, 0) : props.height}
			imageUri={uri}
			width={props.width}
			zoom={props.zoom}
			onLocate={locating ? point => services.positronPlotsService.resolveLocator(point) : undefined}
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
			{locating && <PlotLocatorBanner onFinish={() => services.positronPlotsService.resolveLocator(undefined)} />}
			<div ref={progressRef}></div>
			{uri && renderedImage()}
			{!uri && placeholderImage(error)}
		</div>
	);
};
