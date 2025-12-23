/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useMemo } from 'react';

// Other dependencies.
import { ILanguageRuntimeResourceUsage } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

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

		// Calculate time range
		const timestamps = data.map(d => d.timestamp);
		const minTime = Math.min(...timestamps);
		const maxTime = Math.max(...timestamps);
		const timeRange = maxTime - minTime || 1; // Avoid division by zero

		// Build path points
		const points = data.map((d, i) => {
			const x = ((d.timestamp - minTime) / timeRange) * width;
			// Clamp CPU percentage to 0-100 range
			const cpuPercent = Math.max(0, Math.min(100, d.cpu_percent));
			// Y is inverted (0 at top, height at bottom)
			const y = height - (cpuPercent / 100) * height;
			return { x, y };
		});

		// Sort points by x coordinate to ensure proper line drawing
		points.sort((a, b) => a.x - b.x);

		if (points.length === 0) {
			return { linePath: '', fillPath: '' };
		}

		// Build line path
		const linePoints = points.map((p, i) =>
			i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
		).join(' ');

		// Build fill path (closed polygon from line to bottom of graph)
		const firstPoint = points[0];
		const lastPoint = points[points.length - 1];
		const fillPoints = `${linePoints} L ${lastPoint.x} ${height} L ${firstPoint.x} ${height} Z`;

		return { linePath: linePoints, fillPath: fillPoints };
	}, [data, width, height]);

	return (
		<svg
			className="resource-usage-graph"
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			width={width}
		>
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
