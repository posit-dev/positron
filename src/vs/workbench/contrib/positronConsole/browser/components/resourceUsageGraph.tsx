/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useMemo } from 'react';

// Other dependencies.
import { ILanguageRuntimeResourceUsage } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { localize } from '../../../../../nls.js';

/**
 * Fixed spacing between data points in pixels.
 */
const PIXELS_PER_POINT = 2;

/**
 * Top padding to prevent stroke clipping at 100%.
 */
const TOP_PADDING = 2;

/**
 * Bottom padding (when not drawing flush to the bottom) so the full stroke of a
 * flat 0% idle line is visible rather than half-clipped by the SVG bounds.
 */
const BOTTOM_PADDING = 2;

/**
 * ResourceUsageGraphProps interface.
 */
interface ResourceUsageGraphProps {
	/** The resource usage data points to display */
	data: ILanguageRuntimeResourceUsage[];
	/** The width of the graph in pixels */
	width: number;
	/** The height of the graph in pixels */
	height: number;
	/**
	 * When true, a flat idle line rests directly on a surrounding bottom border
	 * (used by the console action bar, whose graph is framed by a border): the
	 * 0% baseline is inset by half the stroke width so the bottom of the stroke
	 * touches the bottom edge and the full stroke stays visible (rather than the
	 * lower half being clipped). When false (the default), the baseline is inset
	 * by {@link BOTTOM_PADDING} so the full stroke of a flat idle line is
	 * visible (used by the console tab list, which has no surrounding border).
	 */
	flushToBottom?: boolean;
	/**
	 * Width of the line stroke in pixels. Used to inset the baseline when
	 * {@link flushToBottom} is set so the full stroke clears the bottom edge.
	 * Must match the `stroke-width` applied to `.resource-usage-line` in CSS.
	 */
	strokeWidth?: number;
}

const title = localize('positronConsole.resourceUsageGraph.title', 'CPU usage');

/**
 * ResourceUsageGraph component.
 * Renders an SVG line chart showing CPU utilization over time.
 */
export const ResourceUsageGraph = ({ data, width, height, flushToBottom, strokeWidth = 2 }: ResourceUsageGraphProps) => {
	// Calculate the SVG path for the line and fill area
	const { linePath, fillPath } = useMemo(() => {
		if (data.length === 0) {
			return { linePath: '', fillPath: '' };
		}

		// Calculate how many points can fit in the available width
		// Add 1 extra point to ensure the line extends to the left edge
		const maxPointsForWidth = Math.floor(width / PIXELS_PER_POINT) + 1;

		// Slice data to only show what fits, keeping the most recent data
		const visibleData = data.slice(-maxPointsForWidth);

		if (visibleData.length === 0) {
			return { linePath: '', fillPath: '' };
		}

		// Calculate the drawable height. The top is inset by TOP_PADDING so 100%
		// doesn't clip. The 0% baseline is inset from the bottom either by half
		// the stroke width (so a flat idle line rests on a surrounding border
		// with its full stroke visible rather than half-clipped) or by
		// BOTTOM_PADDING (so the full stroke of a flat idle line is visible).
		// See flushToBottom.
		const baseline = flushToBottom ? height - strokeWidth / 2 : height - BOTTOM_PADDING;
		const drawableHeight = baseline - TOP_PADDING;

		// Build path points - draw from right edge, newest data on right
		const points = visibleData.map((d, i) => {
			// Position from right edge: last point at width, earlier points to the left
			const x = width - (visibleData.length - 1 - i) * PIXELS_PER_POINT;
			// Clamp CPU percentage to 0-100 range
			const cpuPercent = Math.max(0, Math.min(100, d.cpu_percent));
			// Y is inverted (0% at the baseline, 100% at the top)
			const y = TOP_PADDING + ((100 - cpuPercent) / 100) * drawableHeight;
			return { x, y };
		});

		// Build line path
		const linePoints = points.map((p, i) =>
			i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
		).join(' ');

		// Build fill path (closed polygon from line to the baseline)
		const firstPoint = points[0];
		const lastPoint = points[points.length - 1];
		const fillPoints = `${linePoints} L ${lastPoint.x} ${baseline} L ${firstPoint.x} ${baseline} Z`;

		return { linePath: linePoints, fillPath: fillPoints };
	}, [data, width, height, flushToBottom]);

	return (
		<svg
			className="resource-usage-graph"
			height={height}
			// When drawing flush to the bottom, fill the rendered box on both
			// axes rather than scaling uniformly. When flex shrinks the chip, the
			// rendered width can fall below the declared width; the default
			// "xMidYMid meet" would then scale the whole graph down and center it
			// vertically, lifting the idle (0%) line off the bottom border.
			// "none" keeps the baseline flush. Otherwise use the SVG default.
			preserveAspectRatio={flushToBottom ? 'none' : undefined}
			viewBox={`0 0 ${width} ${height}`}
			width={width}
		>
			<title>{title}</title>
			{/* Fill area beneath the line */}
			{fillPath && (
				<path
					className="resource-usage-fill"
					d={fillPath}
				/>
			)}
			{/* Line on top */}
			{linePath && (
				<path
					className="resource-usage-line"
					d={linePath}
				/>
			)}
		</svg>
	);
};
