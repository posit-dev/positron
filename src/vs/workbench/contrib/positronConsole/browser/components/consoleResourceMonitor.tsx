/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleResourceMonitor.css';

// React.
import { MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { formatCompactMemory } from '../../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';
import { IAction } from '../../../../../base/common/actions.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { ResourceUsageGraph } from './resourceUsageGraph.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { usePositronActionBarContext } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { ILanguageRuntimeResourceUsage } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

/**
 * Layout constants (in pixels). These mirror the reserved widths applied to
 * the value boxes in consoleResourceMonitor.css; keep them in sync so the
 * layout computation matches what is actually rendered.
 */
const MEM_VALUE_WIDTH = 46;		// Reserves room for e.g. "1023MB" / "10.5GB".
const GRAPH_MIN_WIDTH = 50;
const GRAPH_MAX_WIDTH = 150;
const GAP = 6;					// Gap between adjacent elements (graph, memory value).
const SEPARATOR_WIDTH = 7;		// Trailing ActionBarSeparator; mirrors .action-bar-separator in CSS.

/**
 * The monitor always ends with an ActionBarSeparator, preceded by the standard
 * inter-element gap. This trailing chrome is fixed overhead that must be
 * reserved in every width calculation; otherwise the container is granted less
 * room than it renders and the right-aligned memory value is clipped on its
 * left edge by the container's overflow: hidden.
 */
const TRAILING_SEPARATOR_FOOTPRINT = GAP + SEPARATOR_WIDTH;

/**
 * Extra slack added to the maximum width so the content is never clipped by
 * sub-pixel/font-metric variance (the content is right-aligned with overflow
 * hidden, so any underestimate would clip the leftmost element).
 */
const SAFETY_PADDING = 8;

/**
 * The height of the resource usage graph in pixels.
 */
const GRAPH_HEIGHT = 16;

/**
 * The preferred (maximum) width of the resource monitor, used by the action
 * bar to decide how much horizontal space to grant the monitor. At this width
 * the monitor shows a full-width graph and the memory value.
 */
export const RESOURCE_MONITOR_MAX_WIDTH =
	GRAPH_MAX_WIDTH + GAP + MEM_VALUE_WIDTH + TRAILING_SEPARATOR_FOOTPRINT + SAFETY_PADDING;

const showResourceMonitorLabel = localize('positron.console.showResourceMonitor', "Show Resource Monitor");

/**
 * Shows the context menu offering the "Show Resource Monitor" toggle. This is
 * shared between the monitor itself (right-click to hide) and the empty space in
 * the console action bar (right-click to bring it back), so the affordance is
 * symmetric.
 *
 * @param services The Positron React services.
 * @param x The x coordinate of the mouse event.
 * @param y The y coordinate of the mouse event.
 * @param currentlyVisible Whether the monitor is currently visible; determines
 * the checkmark state and which value the toggle writes.
 */
export function showResourceMonitorContextMenu(services: PositronReactServices, x: number, y: number, currentlyVisible: boolean): void {
	const actions: IAction[] = [{
		id: 'workbench.action.positronConsole.toggleShowResourceMonitor',
		label: showResourceMonitorLabel,
		tooltip: '',
		class: undefined,
		enabled: true,
		checked: currentlyVisible,
		run: () => {
			services.configurationService.updateValue('console.showResourceMonitor', !currentlyVisible);
		}
	}];

	services.contextMenuService.showContextMenu({
		getActions: () => actions,
		getAnchor: () => ({ x, y }),
		anchorAlignment: AnchorAlignment.LEFT,
		anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
	});
}

/**
 * ResourceMonitorLayout interface. Describes which elements the resource
 * monitor should render at a given width.
 */
export interface ResourceMonitorLayout {
	/** Whether to show the memory value. */
	readonly showMemory: boolean;
	/** The width of the usage graph in pixels; 0 means no graph. */
	readonly graphWidth: number;
}

/**
 * Computes which resource monitor elements fit within the available width, and
 * how wide the graph should be. As the width decreases, the graph first shrinks
 * from {@link GRAPH_MAX_WIDTH} to {@link GRAPH_MIN_WIDTH}, then is dropped, and
 * finally the memory value is dropped.
 *
 * @param width The available width in pixels.
 * @returns The resource monitor layout.
 */
export function computeResourceMonitorLayout(width: number): ResourceMonitorLayout {
	// Room needed for the memory value plus the trailing separator chrome.
	const minMemoryWidth = MEM_VALUE_WIDTH + TRAILING_SEPARATOR_FOOTPRINT;

	// Too narrow to show anything.
	if (width < minMemoryWidth) {
		return { showMemory: false, graphWidth: 0 };
	}

	// There is room for the memory value. Determine whether a graph also fits.
	// The graph needs its own width plus the gap that would sit between it and
	// the memory value.
	const graphAvailable = width - minMemoryWidth - GAP;
	if (graphAvailable < GRAPH_MIN_WIDTH) {
		return { showMemory: true, graphWidth: 0 };
	}

	// A graph fits; grow it up to its maximum width.
	return { showMemory: true, graphWidth: Math.min(graphAvailable, GRAPH_MAX_WIDTH) };
}

/**
 * Wires up an action bar hover (tooltip) for a single element. Returns a ref to
 * attach to the target element along with the mouse handlers that show and hide
 * the hover. The hover refreshes live while the pointer stays inside, so it
 * always reflects the latest resource usage.
 *
 * @param content The tooltip text to display.
 * @returns The ref and mouse handlers to spread onto the target element.
 */
function useResourceHover(content: string) {
	const positronActionBarContext = usePositronActionBarContext();
	const hoverManager = positronActionBarContext?.hoverManager;
	const ref = useRef<HTMLDivElement>(null);
	const [mouseInside, setMouseInside] = useState(false);

	// Show (or refresh) the hover while the pointer is inside.
	useEffect(() => {
		if (mouseInside && ref.current) {
			hoverManager?.showHover(ref.current, content);
		}
	}, [mouseInside, hoverManager, content]);

	return {
		ref,
		onMouseEnter: () => setMouseInside(true),
		onMouseLeave: () => {
			setMouseInside(false);
			hoverManager?.hideHover();
		},
	};
}

/**
 * ConsoleResourceMonitorProps interface.
 */
interface ConsoleResourceMonitorProps {
	/** The resource usage history to display, oldest first. */
	readonly data: ILanguageRuntimeResourceUsage[];

	/**
	 * Whether the console is busy. When busy, the interrupt (stop) button is
	 * shown immediately to the monitor's left, so the monitor reserves a small
	 * gap on its left edge to keep its content from butting up against the button.
	 */
	readonly busy?: boolean;
}

/**
 * ConsoleResourceMonitor component.
 *
 * Renders an abbreviated CPU/memory resource monitor for display in the console
 * action bar. It measures its own width and progressively drops detail as space
 * becomes constrained. A right-click context menu allows hiding the monitor.
 *
 * @param props A ConsoleResourceMonitorProps that contains the component properties.
 * @returns The rendered component, or null when there is nothing to show.
 */
export const ConsoleResourceMonitor = ({ data, busy }: ConsoleResourceMonitorProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(null);

	// State hooks.
	const [width, setWidth] = useState(0);

	// Measure our own width so we can decide what to render.
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}

		const disposableStore = new DisposableStore();

		// Set the initial width.
		setWidth(element.offsetWidth);

		// Observe size changes.
		const resizeObserver = new ResizeObserver(() => {
			setWidth(element.offsetWidth);
		});
		resizeObserver.observe(element);
		disposableStore.add(toDisposable(() => resizeObserver.disconnect()));

		return () => disposableStore.dispose();
	}, []);

	const handleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		showResourceMonitorContextMenu(services, e.clientX, e.clientY, true);
	};

	// Compute the layout for the current width.
	const layout = computeResourceMonitorLayout(width);

	// Get the latest data point.
	const latest = data.length > 0 ? data[data.length - 1] : undefined;

	// Format the values, reserving stable widths so they don't shift the layout.
	const cpuValue = latest ? `${Math.round(Math.max(0, Math.min(100, latest.cpu_percent)))}%` : '';
	const memoryValue = latest ? formatCompactMemory(latest.memory_bytes) : '';

	// Tooltips for the graph (which plots CPU usage over time) and the memory value.
	const graphHover = useResourceHover(
		localize('positron.console.resourceMonitor.cpuTooltip', "CPU usage: {0}", cpuValue)
	);
	const memoryHover = useResourceHover(
		localize('positron.console.resourceMonitor.memoryTooltip', "Memory usage: {0}", memoryValue)
	);

	// Determine whether there is any content to show. We always render the
	// measuring container (width 0) so the ResizeObserver can report a width;
	// the content is conditional on the computed layout and available data.
	const hasContent = latest !== undefined && (layout.showMemory || layout.graphWidth > 0);

	// Describe the current usage for assistive technologies.
	const resourceMonitorAriaLabel = latest
		? localize('positron.console.resourceMonitor.ariaLabel', "Resource monitor: CPU {0}, memory {1}", cpuValue, memoryValue)
		: localize('positron.console.resourceMonitor.ariaLabelEmpty', "Resource monitor");

	return (
		// The monitor is a passive status readout (role='img'); the only
		// interaction is a right-click to hide it, which duplicates the Settings
		// toggle.
		<div
			ref={ref}
			aria-label={resourceMonitorAriaLabel}
			className={positronClassNames('console-resource-monitor', { 'busy': busy })}
			role='img'
			onContextMenu={handleContextMenu}
		>
			{hasContent &&
				<>
					{layout.graphWidth > 0 &&
						// eslint-disable-next-line jsx-a11y/no-static-element-interactions -- hover-only tooltip target; the accessible description is on the parent role='img'.
						<div
							ref={graphHover.ref}
							className='resource-usage-graph-chip'
							onMouseEnter={graphHover.onMouseEnter}
							onMouseLeave={graphHover.onMouseLeave}
						>
							<ResourceUsageGraph
								data={data}
								flushToBottom={true}
								height={GRAPH_HEIGHT}
								strokeWidth={1.5}
								width={layout.graphWidth}
							/>
						</div>
					}
					{layout.showMemory &&
						// eslint-disable-next-line jsx-a11y/no-static-element-interactions -- hover-only tooltip target; the accessible description is on the parent role='img'.
						<div
							ref={memoryHover.ref}
							className='resource-usage-memory'
							onMouseEnter={memoryHover.onMouseEnter}
							onMouseLeave={memoryHover.onMouseLeave}
						>
							<span className='resource-usage-value resource-usage-memory-value'>{memoryValue}</span>
						</div>
					}
					<ActionBarSeparator />
				</>
			}
		</div>
	);
};
