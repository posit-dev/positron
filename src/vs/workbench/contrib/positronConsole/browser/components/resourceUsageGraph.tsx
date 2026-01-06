/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useMemo } from 'react';

// Other dependencies.
import { ILanguageRuntimeResourceUsage } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { localize } from '../../../../../nls.js';

/**
 * Fixed spacing between data points in pixels.
 */
const PIXELS_PER_POINT = 2;

/**
 * Vertical padding to prevent stroke clipping at 0% and 100%.
 */
const VERTICAL_PADDING = 2;

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
}

const title = localize('positronConsole.resourceUsageGraph.title', 'CPU usage');

/**
 * ResourceUsageGraph component.
 * Renders an SVG line chart showing CPU utilization over time.
 */
export const ResourceUsageGraph = ({ data, width, height }: ResourceUsageGraphProps) => {
	// Calculate the SVG path for the line and fill area
	const { linePath, fillPath } = useMemo(() => {
		if (data.length === 0) {
			return { linePath: '', fillPath: '' };
		}

		// Calculate how many points can fit in the available width
		const maxPointsForWidth = Math.floor(width / PIXELS_PER_POINT);

		// Slice data to only show what fits, keeping the most recent data
		const visibleData = data.slice(-maxPointsForWidth);

		if (visibleData.length === 0) {
			return { linePath: '', fillPath: '' };
		}

		// Calculate the drawable height (accounting for padding)
		const drawableHeight = height - 2 * VERTICAL_PADDING;

		// Build path points - draw from right edge, newest data on right
		const points = visibleData.map((d, i) => {
			// Position from right edge: last point at width, earlier points to the left
			const x = width - (visibleData.length - 1 - i) * PIXELS_PER_POINT;
			// Clamp CPU percentage to 0-100 range
			const cpuPercent = Math.max(0, Math.min(100, d.cpu_percent));
			// Y is inverted (0 at top, height at bottom) with padding
			const y = VERTICAL_PADDING + ((100 - cpuPercent) / 100) * drawableHeight;
			return { x, y };
		});

		// Build line path
		const linePoints = points.map((p, i) =>
			i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
		).join(' ');

		// Build fill path (closed polygon from line to bottom of graph)
		const firstPoint = points[0];
		const lastPoint = points[points.length - 1];
		// Use height - VERTICAL_PADDING for the bottom to stay within bounds
		const bottomY = height - VERTICAL_PADDING;
		const fillPoints = `${linePoints} L ${lastPoint.x} ${bottomY} L ${firstPoint.x} ${bottomY} Z`;

		return { linePath: linePoints, fillPath: fillPoints };
	}, [data, width, height]);

	return (
		<svg
			className="resource-usage-graph"
			height={height}
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
