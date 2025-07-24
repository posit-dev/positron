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
 * BinItem component to provide hover and tooltip functionality for a histogram bin
 */
const BinItem = React.memo(({
	binCount,
	binCountHeight,
	binCountPercent,
	binMax,
	binMin,
	binStart,
	binWidth,
	graphHeight,
	hoverManager,
	xAxisHeight
}: {
	binCount: number;
	binCountHeight: number;
	binCountPercent: string;
	binMax: string;
	binMin: string;
	binStart: number;
	binWidth: number;
	graphHeight: number;
	hoverManager: IHoverManager;
	xAxisHeight: number;
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

	return (
		<foreignObject
			className='tooltip-container'
			height={graphHeight}
			width={binWidth}
			x={binStart}
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
					{isHovered && (
						<rect
							className='bin-count-hover'
							height={binCountHeight}
							width={binWidth}
							x={0}
							y={graphHeight - xAxisHeight - binCountHeight}
						/>
					)}
					{/* Invisible rect for hover detection */}
					<rect
						fill='transparent'
						height={graphHeight}
						pointerEvents='all'
						width={binWidth}
						x={0}
						y={0}
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

	// Build a single path for all bins to avoid gaps
	const buildHistogramPath = () => {
		let path = '';
		const binCounts = props.columnHistogram.bin_counts;
		const numBins = binCounts.length;

		for (let i = 0; i < numBins; i++) {
			const binHeight = (binCounts[i] / maxBinCount) * props.graphHeight;
			const x = (i / numBins) * props.graphWidth;
			const nextX = ((i + 1) / numBins) * props.graphWidth;
			const y = props.graphHeight - props.xAxisHeight - binHeight;

			// Move to bottom left of bin
			if (i === 0) {
				path += `M ${x} ${props.graphHeight - props.xAxisHeight} `;
			}

			// Line to top left
			path += `L ${x} ${y} `;
			// Line to top right
			path += `L ${nextX} ${y} `;
			// Line to bottom right
			path += `L ${nextX} ${props.graphHeight - props.xAxisHeight} `;
		}

		// Close the path
		path += 'Z';
		return path;
	};

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
				<path
					className='bin-count'
					d={buildHistogramPath()}
					fill='var(--vscode-positronDataExplorer-sparklineFill)'
				/>
				{props.columnHistogram.bin_counts.map((binCount, binCountIndex) => {
					const binCountHeight = (binCount / maxBinCount) * props.graphHeight;
					const binMin = props.columnHistogram.bin_edges[binCountIndex];
					const binMax = props.columnHistogram.bin_edges[binCountIndex + 1];
					// Calculate percentage of the total
					const binCountPercent = totalBinCount > 0 ? ((binCount / totalBinCount) * 100).toFixed(1) : '0.0';

					// Calculate positions for hover areas
					const x = (binCountIndex / props.columnHistogram.bin_counts.length) * props.graphWidth;
					const width = props.graphWidth / props.columnHistogram.bin_counts.length;

					return (
						<BinItem
							key={`bin-item-${binCountIndex}`}
							binCount={binCount}
							binCountHeight={binCountHeight}
							binCountPercent={binCountPercent}
							binMax={binMax}
							binMin={binMin}
							binStart={x}
							binWidth={width}
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
