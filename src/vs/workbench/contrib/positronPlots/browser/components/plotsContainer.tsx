/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './plotsContainer.css';

// React.
import React, { useEffect, useMemo, useRef } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { DynamicPlotInstance } from './dynamicPlotInstance.js';
import { DynamicPlotThumbnail } from './dynamicPlotThumbnail.js';
import { PlotGalleryThumbnail } from './plotGalleryThumbnail.js';
import { StaticPlotInstance } from './staticPlotInstance.js';
import { StaticPlotThumbnail } from './staticPlotThumbnail.js';
import { WebviewPlotInstance } from './webviewPlotInstance.js';
import { WebviewPlotThumbnail } from './webviewPlotThumbnail.js';
import { usePositronPlotsContext } from '../positronPlotsContext.js';
import { WebviewPlotClient } from '../webviewPlotClient.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { DarkFilter, IPositronPlotClient, isZoomablePlotClient, PlotRenderFormat, ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';
import { PlotSizingPolicyIntrinsic } from '../../../../services/positronPlots/common/sizingPolicyIntrinsic.js';
import { PlotSizingPolicyAuto } from '../../../../services/positronPlots/common/sizingPolicyAuto.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

/**
 * PlotContainerProps interface.
 */
interface PlotContainerProps {
	width: number;
	height: number;
	x: number;
	y: number;
	visible: boolean;
	showHistory: boolean;
	darkFilterMode: DarkFilter;
}

/**
 * The number of pixels (height or width) to use for the history portion of the
 * plots container.
 */
export const HistoryPx = 100;

/**
 * The number of pixels (height) to use for the plot info header row.
 */
export const PlotInfoHeaderPx = 24;

/**
 * PlotContainer component; holds the plot instances.
 *
 * @param props A PlotContainerProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlotsContainer = (props: PlotContainerProps) => {
	const services = usePositronReactServicesContext();
	const positronPlotsContext = usePositronPlotsContext();
	const plotHistoryRef = React.createRef<HTMLDivElement>();
	const containerRef = useRef<HTMLDivElement>(undefined!);
	const [zoom, setZoom] = React.useState<ZoomLevel>(ZoomLevel.Fit);

	// We generally prefer showing the plot history on the bottom (making the
	// plot wider), but if the plot container is too wide, we show it on the
	// right instead.
	const historyBottom = props.height / props.width > 0.75;

	const historyPx = props.showHistory ? HistoryPx : 0;
	const historyEdge = historyBottom ? 'history-bottom' : 'history-right';
	// Account for the plot info header when calculating plot dimensions
	const plotHeight = historyBottom && props.height > 0 ? props.height - historyPx - PlotInfoHeaderPx : props.height - PlotInfoHeaderPx;
	const plotWidth = historyBottom || props.width <= 0 ? props.width : props.width - historyPx;

	// Get the current plot instance
	const currentPlotInstance = useMemo(() =>
		positronPlotsContext.positronPlotInstances.find(
			(plotInstance) => plotInstance.id === positronPlotsContext.selectedInstanceId
		),
		[positronPlotsContext.positronPlotInstances, positronPlotsContext.selectedInstanceId]
	);

	// State to track metadata updates and trigger re-renders
	const [metadataVersion, setMetadataVersion] = React.useState(0);

	// State to track session name updates and trigger re-renders
	const [sessionNameVersion, setSessionNameVersion] = React.useState(0);

	// Listen for metadata updates from the plots service (service-level event)
	useEffect(() => {
		const disposable = services.positronPlotsService.onDidUpdatePlotMetadata((plotId) => {
			// Only trigger re-render if the updated plot is the current one
			if (plotId === positronPlotsContext.selectedInstanceId) {
				setMetadataVersion(v => v + 1);
			}
		});
		return () => disposable.dispose();
	}, [services.positronPlotsService, positronPlotsContext.selectedInstanceId]);

	// Listen for session name updates to update the displayed session name
	useEffect(() => {
		const disposable = services.runtimeSessionService.onDidUpdateSessionName((session) => {
			// Only trigger re-render if the updated session is the current plot's session
			if (currentPlotInstance && session.sessionId === currentPlotInstance.metadata.session_id) {
				setSessionNameVersion(v => v + 1);
			}
		});
		return () => disposable.dispose();
	}, [services.runtimeSessionService, currentPlotInstance]);

	// Get the session name for the current plot
	const sessionName = useMemo(() => {
		if (!currentPlotInstance) {
			return undefined;
		}
		const sessionId = currentPlotInstance.metadata.session_id;
		const session = services.runtimeSessionService.getSession(sessionId);
		if (session) {
			// Use dynState.sessionName to get the current (possibly renamed) session name
			return session.dynState.sessionName;
		}
		// Fallback to the language name from metadata if session is not found
		return currentPlotInstance.metadata.language;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentPlotInstance, services.runtimeSessionService, metadataVersion, sessionNameVersion]);

	// Get the plot name from metadata (reactive to metadata updates)
	const plotName = useMemo(() => {
		return currentPlotInstance?.metadata.name;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentPlotInstance, metadataVersion]);

	// Plot history useEffect to handle scrolling, mouse wheel events, and keyboard navigation.
	useEffect(() => {
		// Get the current plot history and container. If the plot history is not rendered,
		// return.
		const plotHistory = plotHistoryRef.current;
		const container = containerRef.current;
		if (!plotHistory || !container) {
			return;
		}

		// Ensure that the selected plot or the most recently generated plot is
		// is visible in the plot history.
		const selectedPlot = plotHistory.querySelector('.selected');
		if (selectedPlot) {
			// If there is a selected plot, scroll it into view.
			selectedPlot.scrollIntoView({ behavior: 'smooth' });
		} else {
			// If there isn't a selected plot, scroll the history to the end to
			// show the most recently generated plot.
			plotHistory.scrollLeft = plotHistory.scrollWidth;
			plotHistory.scrollTop = plotHistory.scrollHeight;
		}

		// The keyboard event listener for the plot container.
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
				e.preventDefault();
				services.positronPlotsService.selectPreviousPlot();
			} else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
				e.preventDefault();
				services.positronPlotsService.selectNextPlot();
			}
		};

		// If the plot history is not at the bottom, there is no need to handle
		// horizontal scrolling with the mouse wheel.
		if (!historyBottom) {
			// Add keyboard event listener to the container
			container.addEventListener('keydown', onKeyDown);

			return () => {
				container.removeEventListener('keydown', onKeyDown);
			};
		}

		// The wheel event listener for the plot history. This allows the user to
		// scroll the plot history horizontally using the mouse wheel. We prevent
		// the default behavior to avoid scrolling the entire page when the user
		// scrolls deltaY over the plot history.
		const onWheel = (e: WheelEvent) => {
			// Convert deltaY into deltaX for horizontal scrolling.
			if (e.deltaY !== 0) {
				e.preventDefault();
				plotHistory.scrollLeft += e.deltaY;
			}
		};

		// Add the wheel event listener to the plot history. (The passive: false
		// option indicates that we might call preventDefault() inside our event
		// handler.)
		plotHistory.addEventListener('wheel', onWheel, { passive: false });

		// Add keyboard event listener to the container
		container.addEventListener('keydown', onKeyDown);

		// Cleanup function to remove the wheel and keyboard event listeners when the component
		// unmounts.
		return () => {
			plotHistory.removeEventListener('wheel', onWheel);
			container.removeEventListener('keydown', onKeyDown);
		};
	}, [historyBottom, containerRef, plotHistoryRef, services.positronPlotsService]);

	useEffect(() => {
		// Be defensive against null sizes when pane is invisible
		if (plotWidth <= 0 || plotHeight <= 0) {
			return;
		}

		const notify = () => {
			let policy = services.positronPlotsService.selectedSizingPolicy;

			if (policy instanceof PlotSizingPolicyIntrinsic) {
				policy = new PlotSizingPolicyAuto;
			}

			const viewPortSize = {
				height: plotHeight,
				width: plotWidth,
			}
			let size = policy.getPlotSize(viewPortSize);
			size = size ? size : viewPortSize;

			services.positronPlotsService.setPlotsRenderSettings({
				size,
				pixel_ratio: DOM.getWindow(containerRef.current).devicePixelRatio,
				format: PlotRenderFormat.Png, // Currently hard-coded
			});
		};

		// Renotify if the sizing policy changes
		const disposables = new DisposableStore();
		disposables.add(services.positronPlotsService.onDidChangeSizingPolicy((_policy) => {
			notify();
		}));

		// Propagate current render settings. Use a debouncer to avoid excessive
		// messaging to language kernels.
		const debounceTimer = setTimeout(() => {
			notify()
		}, 500);

		return () => {
			clearTimeout(debounceTimer);
			disposables.dispose();
		};
	}, [plotWidth, plotHeight, services.positronPlotsService]);

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Get the current plot instance using the selected instance ID from the
		// PositronPlotsContext.
		const currentPlotInstance = positronPlotsContext.positronPlotInstances.find(
			(plotInstance) => plotInstance.id === positronPlotsContext.selectedInstanceId
		);
		if (currentPlotInstance && isZoomablePlotClient(currentPlotInstance)) {
			// Listen to the plot instance for zoom level changes.
			disposableStore.add(currentPlotInstance.onDidChangeZoomLevel((zoomLevel) => {
				setZoom(zoomLevel);
			}));
			// Set the initial zoom level.
			setZoom(currentPlotInstance.zoomLevel);
		}
		return () => {
			// Dispose of the disposable store when the component unmounts.
			disposableStore.dispose();
		}
	}, [positronPlotsContext.positronPlotInstances, positronPlotsContext.selectedInstanceId]);

	/**
	 * Renders either a DynamicPlotInstance (resizable plot), a
	 * StaticPlotInstance (static plot image), or a WebviewPlotInstance
	 * (interactive HTML plot) depending on the type of plot instance.
	 *
	 * @param plotInstance The plot instance to render
	 * @returns The rendered component.
	 */
	const render = (plotInstance: IPositronPlotClient) => {
		if (plotInstance instanceof PlotClientInstance) {
			return <DynamicPlotInstance
				key={plotInstance.id}
				height={plotHeight}
				plotClient={plotInstance}
				width={plotWidth}
				zoom={zoom} />;
		} else if (plotInstance instanceof StaticPlotClient) {
			return <StaticPlotInstance
				key={plotInstance.id}
				plotClient={plotInstance}
				zoom={zoom} />;
		} else if (plotInstance instanceof WebviewPlotClient) {
			return <WebviewPlotInstance
				key={plotInstance.id}
				height={plotHeight}
				plotClient={plotInstance}
				visible={props.visible}
				width={plotWidth} />;
		}

		return null;
	};

	/**
	 * Focuses the plot thumbnail for the given plot ID.
	 * @param plotId The ID of the plot to focus on.
	 */
	const focusPlotThumbnail = (plotId: string) => {
		const plotHistory = plotHistoryRef.current;
		if (!plotHistory) {
			return;
		}
		const plotThumbnailElement = plotHistory.querySelector(
			`.plot-thumbnail-button[data-plot-id="${plotId}"]`
		) as HTMLButtonElement;
		if (plotThumbnailElement) {
			plotThumbnailElement.focus();
		}
	};

	/**
	 * Focuses the previous plot thumbnail in the history.
	 * @param currentPlotId The ID of the currently selected plot.
	 */
	const focusPreviousPlotThumbnail = (currentPlotId: string) => {
		const currentPlotIndex = positronPlotsContext.positronPlotInstances.findIndex(
			(plotInstance) => plotInstance.id === currentPlotId
		);
		if (currentPlotIndex === -1) {
			return;
		}
		if (currentPlotIndex === 0) {
			return;
		}
		const previousPlotInstance = positronPlotsContext.positronPlotInstances[currentPlotIndex - 1];
		focusPlotThumbnail(previousPlotInstance.id);
	}

	/**
	 * Focuses the next plot thumbnail in the history.
	 * @param currentPlotId The ID of the currently selected plot.
	 */
	const focusNextPlotThumbnail = (currentPlotId: string) => {
		const currentPlotIndex = positronPlotsContext.positronPlotInstances.findIndex(
			(plotInstance) => plotInstance.id === currentPlotId
		);
		if (currentPlotIndex === -1) {
			return;
		}
		if (currentPlotIndex === positronPlotsContext.positronPlotInstances.length - 1) {
			return;
		}
		const nextPlotInstance = positronPlotsContext.positronPlotInstances[currentPlotIndex + 1];
		focusPlotThumbnail(nextPlotInstance.id);
	}

	/**
	 * Renders a thumbnail of either a DynamicPlotInstance (resizable plot), a
	 * StaticPlotInstance (static plot image), or a WebviewPlotInstance
	 * (interactive HTML plot) depending on the type of plot instance.
	 *
	 * @param plotInstance The plot instance to render
	 * @param selected Whether the thumbnail is selected
	 * @returns
	 */
	const renderThumbnail = (plotInstance: IPositronPlotClient, selected: boolean) => {
		const renderThumbnailImage = () => {
			if (plotInstance instanceof PlotClientInstance) {
				return <DynamicPlotThumbnail plotClient={plotInstance} />;
			} else if (plotInstance instanceof StaticPlotClient) {
				return <StaticPlotThumbnail plotClient={plotInstance} />;
			} else if (plotInstance instanceof WebviewPlotClient) {
				return <WebviewPlotThumbnail plotClient={plotInstance} />;
			} else {
				return null;
			}
		};

		return <PlotGalleryThumbnail
			key={plotInstance.id}
			focusNextPlotThumbnail={focusNextPlotThumbnail}
			focusPreviousPlotThumbnail={focusPreviousPlotThumbnail}
			plotClient={plotInstance}
			selected={selected}>
			{renderThumbnailImage()}
		</PlotGalleryThumbnail>;
	};

	// Render the plot history gallery.
	const renderHistory = () => {
		return <div ref={plotHistoryRef} className='plot-history-scroller'>
			<div className='plot-history'>
				{positronPlotsContext.positronPlotInstances.map((plotInstance) => (
					renderThumbnail(plotInstance,
						plotInstance.id === positronPlotsContext.selectedInstanceId)
				))}
			</div>
		</div>;
	};

	// Render the plot info header showing the session name and plot name.
	const renderPlotInfoHeader = () => {
		if (!currentPlotInstance) {
			return null;
		}

		// If no info to display, show a placeholder to maintain consistent height
		if (!sessionName && !plotName) {
			return <div className='plot-info-header'>
				<span className='plot-info-text'>&nbsp;</span>
			</div>;
		}

		return <div className='plot-info-header' style={{ height: PlotInfoHeaderPx }}>
			<span className='plot-info-text'>
				{sessionName && <span className='plot-session-name'>{sessionName}</span>}
				{plotName && <span className='plot-name'>{plotName}</span>}
			</span>
		</div>;
	};

	// If there are no plot instances, show a placeholder; otherwise, show the
	// most recently generated plot.
	return (
		<div ref={containerRef} className={'plots-container dark-filter-' + props.darkFilterMode + ' ' + historyEdge} tabIndex={0}>
			<div className='plot-content'>
				{positronPlotsContext.positronPlotInstances.length > 0 && renderPlotInfoHeader()}
				<div className='selected-plot'>
					{positronPlotsContext.positronPlotInstances.length === 0 &&
						<div className='plot-placeholder'></div>}
					{positronPlotsContext.positronPlotInstances.map((plotInstance, index) => (
						plotInstance.id === positronPlotsContext.selectedInstanceId &&
						render(plotInstance)
					))}
				</div>
			</div>
			{props.showHistory && renderHistory()}
		</div>
	);
};
