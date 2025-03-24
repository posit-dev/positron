/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './vectorHistogram.css';

// React.
import React, { useState, useRef, useMemo } from 'react';

// Other dependencies.
import { ColumnHistogram } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { IHoverManager } from '../../../../../platform/hover/browser/hoverManager.js';

/**
 * VectorHistogramProps interface.
 */
interface VectorHistogramProps {
	readonly graphWidth: number;
	readonly graphHeight: number;
	readonly xAxisHeight: number;
	readonly columnHistogram: ColumnHistogram;
	readonly hoverManager: IHoverManager;
}

/**
 * BinItem component to render a single histogram bin with tooltip
 */
const BinItem = React.memo(({
	binCount,
	binCountIndex,
	binMin,
	binMax,
	binWidth,
	binCountHeight,
	graphHeight,
	xAxisHeight,
	binCountPercent,
	hoverManager
}: {
	binCount: number;
	binCountIndex: number;
	binMin: string;
	binMax: string;
	binWidth: number;
	binCountHeight: number;
	graphHeight: number;
	xAxisHeight: number;
	binCountPercent: string;
	hoverManager: IHoverManager;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isHovered, setIsHovered] = useState(false);

	// Format numeric values with 4 significant digits if they're numbers
	const formatValue = (value: string): string => {
		const num = parseFloat(value);
		return !isNaN(num) ? num.toPrecision(4) : value;
	};

	const formattedMin = formatValue(binMin);
	const formattedMax = formatValue(binMax);

	// Calculate exact bin position and width to avoid 1-pixel gaps between bins
	const binPosition = Math.round(binCountIndex * binWidth);

	// Make sure bin width is at least 1
	binWidth = Math.max(1, Math.round((binCountIndex + 1) * binWidth) - binPosition);

	return (
		<foreignObject
			key={`bin-count-container-${binCountIndex}`}
			className='tooltip-container'
			height={graphHeight}
			width={binWidth}
			x={binPosition}
			y={0}
		>
			<div
				ref={containerRef}
				style={{
					cursor: 'default',
					height: '100%',
					position: 'relative',
					width: '100%'
				}}
				onMouseLeave={() => {
					hoverManager.hideHover();
					setIsHovered(false);
				}}
				onMouseOver={() => {
					setIsHovered(true);
					if (containerRef.current) {
						hoverManager.showHover(
							containerRef.current,
							`Range: ${formattedMin} to ${formattedMax}\nCount: ${binCount} (${binCountPercent}%)`
						);
					}
				}}
			>
				<svg height='100%' width='100%'>
					<rect
						className={isHovered ? 'bin-count-hover' : 'bin-count'}
						height={binCountHeight}
						width={binWidth}
						x={0}
						y={graphHeight - xAxisHeight - binCountHeight}
					/>
				</svg>
			</div>
		</foreignObject>
	);
});

/**
 * VectorHistogram component.
 * @param props A VectorHistogramProps that contains the component properties.
 * @returns The rendered component.
 */
export const VectorHistogram = (props: VectorHistogramProps) => {
	// State hooks.
	const [binWidth] = useState(() => {
		// Get the number of bin counts that will be rendered.
		const binCounts = props.columnHistogram.bin_counts.length;

		// If the number of bin counts that will be rendered is 0, return 0.
		if (!binCounts) {
			return 0;
		}

		// Calculate and return the bin width.
		return props.graphWidth / binCounts;
	});
	const [maxBinCount] = useState(() => {
		// Find the max bin count.
		let maxBinCount = 0;
		for (let i = 0; i < props.columnHistogram.bin_counts.length; i++) {
			const binCount = props.columnHistogram.bin_counts[i];
			if (binCount > maxBinCount) {
				maxBinCount = binCount;
			}
		}

		// Return the max bin count.
		return maxBinCount;
	});

	// Calculate the total bin count once for percentage calculations
	const totalBinCount = useMemo(() => {
		return props.columnHistogram.bin_counts.reduce((sum, count) => sum + count, 0);
	}, [props.columnHistogram.bin_counts]);

	// Render.
	return (
		<svg
			className='vector-histogram'
			shapeRendering='crispEdges'
			viewBox={`0 0 ${props.graphWidth} ${props.graphHeight + props.xAxisHeight}`}
		>
			<g>
				<rect className='x-axis'
					height={props.xAxisHeight}
					width={props.graphWidth}
					x={0}
					y={props.graphHeight - props.xAxisHeight}
				/>
				{props.columnHistogram.bin_counts.map((binCount, binCountIndex) => {
					const binCountHeight = (binCount / maxBinCount) * props.graphHeight;
					const binMin = props.columnHistogram.bin_edges[binCountIndex];
					const binMax = props.columnHistogram.bin_edges[binCountIndex + 1];
					// Calculate percentage of the total
					const binCountPercent = totalBinCount > 0 ? ((binCount / totalBinCount) * 100).toFixed(1) : '0.0';

					return (
						<BinItem
							key={`bin-item-${binCountIndex}`}
							binCount={binCount}
							binCountHeight={binCountHeight}
							binCountIndex={binCountIndex}
							binCountPercent={binCountPercent}
							binMax={binMax}
							binMin={binMin}
							binWidth={binWidth}
							graphHeight={props.graphHeight}
							hoverManager={props.hoverManager}
							xAxisHeight={props.xAxisHeight}
						/>
					);
				})}
			</g>
		</svg>
	);
};
