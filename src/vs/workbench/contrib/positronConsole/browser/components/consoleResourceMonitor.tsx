/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleResourceMonitor.css';

// React.
import { MouseEvent, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { IAction } from '../../../../../base/common/actions.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { ResourceUsageGraph } from './resourceUsageGraph.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ILanguageRuntimeResourceUsage } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

/**
 * Layout constants (in pixels). These mirror the reserved widths applied to
 * the value boxes in consoleResourceMonitor.css; keep them in sync so the
 * layout computation matches what is actually rendered.
 */
const CPU_VALUE_WIDTH = 30;		// Reserves room for "100%".
const MEM_VALUE_WIDTH = 56;		// Reserves room for e.g. "888.88GB".
const CPU_LABEL_WIDTH = 28;		// Reserves room for the "CPU" label.
const MEM_LABEL_WIDTH = 28;		// Reserves room for the "MEM" label.
const LABEL_VALUE_GAP = 4;		// Gap between a label and its value.
const GRAPH_MIN_WIDTH = 50;
const GRAPH_MAX_WIDTH = 150;
const GAP = 6;					// Gap between adjacent elements (stat groups, graph).

/**
 * Extra slack added to the labels threshold so the labels never get clipped by
 * sub-pixel/font-metric variance (the content is right-aligned with overflow
 * hidden, so any underestimate would clip the leftmost label).
 */
const SAFETY_PADDING = 8;

/**
 * The height of the resource usage graph in pixels.
 */
const GRAPH_HEIGHT = 16;

/** The width of a CPU/MEM stat group including its label. */
const CPU_STAT_WIDTH = CPU_LABEL_WIDTH + LABEL_VALUE_GAP + CPU_VALUE_WIDTH;
const MEM_STAT_WIDTH = MEM_LABEL_WIDTH + LABEL_VALUE_GAP + MEM_VALUE_WIDTH;

/**
 * The preferred (maximum) width of the resource monitor, used by the action
 * bar to decide how much horizontal space to grant the monitor. At this width
 * the monitor shows labels, a full-width graph, and both values.
 */
export const RESOURCE_MONITOR_MAX_WIDTH =
	CPU_STAT_WIDTH + GAP + GRAPH_MAX_WIDTH + GAP + MEM_STAT_WIDTH + SAFETY_PADDING;

const cpuLabel = localize('positronConsole.resourceMonitor.cpuLabel', 'CPU');
const memoryLabel = localize('positronConsole.resourceMonitor.memoryLabel', 'MEM');
const showResourceMonitorLabel = localize('positron.console.showResourceMonitor', "Show Resource Monitor");

/**
 * ResourceMonitorLayout interface. Describes which elements the resource
 * monitor should render at a given width.
 */
export interface ResourceMonitorLayout {
	/** Whether to show the CPU percentage value. */
	readonly showCpu: boolean;
	/** Whether to show the memory value. */
	readonly showMemory: boolean;
	/** Whether to show the "CPU"/"MEM" text labels. */
	readonly showLabels: boolean;
	/** The width of the usage graph in pixels; 0 means no graph. */
	readonly graphWidth: number;
}

/**
 * Computes which resource monitor elements fit within the available width, and
 * how wide the graph should be. As the width decreases, elements are dropped in
 * this order: labels, then the graph (which first shrinks from
 * {@link GRAPH_MAX_WIDTH} to {@link GRAPH_MIN_WIDTH}), then the memory value,
 * then the CPU value.
 *
 * @param width The available width in pixels.
 * @returns The resource monitor layout.
 */
export function computeResourceMonitorLayout(width: number): ResourceMonitorLayout {
	// Too narrow to show anything.
	if (width < CPU_VALUE_WIDTH) {
		return { showCpu: false, showMemory: false, showLabels: false, graphWidth: 0 };
	}

	// Enough room for the CPU value only.
	const statsWidth = CPU_VALUE_WIDTH + GAP + MEM_VALUE_WIDTH;
	if (width < statsWidth) {
		return { showCpu: true, showMemory: false, showLabels: false, graphWidth: 0 };
	}

	// Enough room for both values. Determine whether a graph also fits.
	const graphAvailable = width - statsWidth - GAP;
	if (graphAvailable < GRAPH_MIN_WIDTH) {
		return { showCpu: true, showMemory: true, showLabels: false, graphWidth: 0 };
	}

	// A graph fits; only show the labels once there is room for the labels plus
	// a full-width graph (labels are the first thing dropped as width shrinks).
	if (width >= RESOURCE_MONITOR_MAX_WIDTH) {
		return { showCpu: true, showMemory: true, showLabels: true, graphWidth: GRAPH_MAX_WIDTH };
	}

	return {
		showCpu: true,
		showMemory: true,
		showLabels: false,
		graphWidth: Math.min(graphAvailable, GRAPH_MAX_WIDTH),
	};
}

/**
 * ConsoleResourceMonitorProps interface.
 */
interface ConsoleResourceMonitorProps {
	/** The resource usage history to display, oldest first. */
	readonly data: ILanguageRuntimeResourceUsage[];
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
export const ConsoleResourceMonitor = ({ data }: ConsoleResourceMonitorProps) => {
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

	// Shows the context menu allowing the user to hide the resource monitor.
	const showContextMenu = (x: number, y: number) => {
		const actions: IAction[] = [{
			id: 'workbench.action.positronConsole.toggleShowResourceMonitor',
			label: showResourceMonitorLabel,
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: true,
			run: () => {
				services.configurationService.updateValue('console.showResourceMonitor', false);
			}
		}];

		services.contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => ({ x, y }),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
		});
	};

	const handleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		showContextMenu(e.clientX, e.clientY);
	};

	// Compute the layout for the current width.
	const layout = computeResourceMonitorLayout(width);

	// Get the latest data point.
	const latest = data.length > 0 ? data[data.length - 1] : undefined;

	// Format the values, reserving stable widths so they don't shift the layout.
	const cpuValue = latest ? `${Math.round(Math.max(0, Math.min(100, latest.cpu_percent)))}%` : '';
	const memoryValue = latest ? ByteSize.formatSize(latest.memory_bytes) : '';

	// Determine whether there is any content to show. We always render the
	// measuring container (width 0) so the ResizeObserver can report a width;
	// the content is conditional on the computed layout and available data.
	const hasContent = latest !== undefined && (layout.showCpu || layout.showMemory || layout.graphWidth > 0);

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
			className='console-resource-monitor'
			role='img'
			onContextMenu={handleContextMenu}
		>
			{hasContent &&
				<>
					{layout.showCpu &&
						<div className='resource-usage-cpu'>
							{layout.showLabels &&
								<span className='resource-usage-label'>{cpuLabel}</span>
							}
							<span className='resource-usage-value resource-usage-cpu-value'>{cpuValue}</span>
						</div>
					}
					{layout.graphWidth > 0 &&
						<div className='resource-usage-graph-chip'>
							<ResourceUsageGraph
								data={data}
								height={GRAPH_HEIGHT}
								width={layout.graphWidth}
							/>
						</div>
					}
					{layout.showMemory &&
						<div className='resource-usage-memory'>
							{layout.showLabels &&
								<span className='resource-usage-label'>{memoryLabel}</span>
							}
							<span className='resource-usage-value resource-usage-memory-value'>{memoryValue}</span>
						</div>
					}
					<ActionBarSeparator />
				</>
			}
		</div>
	);
};
