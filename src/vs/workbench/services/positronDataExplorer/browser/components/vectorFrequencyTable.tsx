/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './vectorFrequencyTable.css';

// React.
import React, { useState, useRef, useMemo } from 'react';

// Other dependencies.
import { ColumnFrequencyTable } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { IHoverManager } from '../../../../../platform/hover/browser/hoverManager.js';

/**
 * VectorFrequencyTableProps interface.
 */
interface VectorFrequencyTableProps {
	readonly graphWidth: number;
	readonly graphHeight: number;
	readonly xAxisHeight: number;
	readonly columnFrequencyTable: ColumnFrequencyTable;
	readonly hoverManager: IHoverManager;
}

/**
 * FrequencyCount component to render a single bar with tooltip
 */
const FrequencyCount = React.memo(({
	count,
	countIndex,
	value,
	countWidth,
	countHeight,
	graphHeight,
	xAxisHeight,
	countPercent,
	xPosition,
	hoverManager
}: {
	count: number;
	countIndex: number;
	value: string | number;
	countWidth: number;
	countHeight: number;
	graphHeight: number;
	xAxisHeight: number;
	countPercent: string;
	xPosition: number;
	hoverManager: IHoverManager;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isHovered, setIsHovered] = useState(false);

	// Format numeric values with 4 significant digits if they're numbers
	const formatValue = (val: string | number): string | number => {
		if (typeof val === 'number') {
			return val.toPrecision(4);
		}
		const num = parseFloat(String(val));
		return !isNaN(num) ? num.toPrecision(4) : val;
	};

	const formattedValue = formatValue(value);

	return (
		<foreignObject
			key={`count-${countIndex}`}
			className='tooltip-container'
			height={graphHeight}
			width={countWidth}
			x={xPosition}
			y={0}
		>
			<div
				ref={containerRef}
				style={{
					height: '100%',
					width: '100%',
					position: 'relative',
				}}
				onMouseLeave={() => {
					hoverManager?.hideHover();
					setIsHovered(false);
				}}
				onMouseOver={() => {
					setIsHovered(true);
					if (containerRef.current) {
						hoverManager.showHover(
							containerRef.current,
							`Value: ${formattedValue}\nCount: ${count} (${countPercent}%)`
						);
					}
				}}
			>
				<svg height='100%' width='100%'>
					<rect
						className={isHovered ? 'count-hover' : 'count'}
						height={countHeight}
						width='100%'
						x={0}
						y={graphHeight - xAxisHeight - countHeight}
					/>
				</svg>
			</div>
		</foreignObject >
	);
});

/**
 * OtherCount component to render the "other" bar with tooltip
 */
const OtherCount = React.memo(({
	otherCount,
	maxCount,
	totalCount,
	graphHeight,
	graphWidth,
	xAxisHeight,
	xPosition,
	hoverManager
}: {
	otherCount: number;
	maxCount: number;
	totalCount: number;
	graphHeight: number;
	graphWidth: number;
	xAxisHeight: number;
	xPosition: number;
	hoverManager: IHoverManager;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isHovered, setIsHovered] = useState(false);
	const countHeight = (otherCount / maxCount) * graphHeight;
	const otherCountPercent = totalCount > 0 ? ((otherCount / totalCount) * 100).toFixed(1) : '0.0';

	return (
		<foreignObject
			className='tooltip-container'
			height={graphHeight}
			width={graphWidth - xPosition}
			x={xPosition}
			y={0}
		>
			<div
				ref={containerRef}
				style={{
					height: '100%',
					width: '100%',
					position: 'relative',
				}}
				onMouseLeave={() => {
					hoverManager.hideHover();
					setIsHovered(false);
				}}
				onMouseOver={() => {
					setIsHovered(true);
					if (containerRef.current) {
						hoverManager.showHover(containerRef.current, `Other values\nCount: ${otherCount} (${otherCountPercent}%)`);
					}
				}}
			>
				<svg height='100%' width='100%'>
					<rect
						className={isHovered ? 'count-hover other' : 'count other'}
						height={countHeight}
						width='100%'
						x={0}
						y={graphHeight - xAxisHeight - countHeight}
					/>
				</svg>
			</div>
		</foreignObject >
	);
});

/**
 * VectorFrequencyTable component.
 * @param props A VectorFrequencyTableProps that contains the component properties.
 * @returns The rendered component.
 */
export const VectorFrequencyTable = (props: VectorFrequencyTableProps) => {
	// State hooks.
	const [countWidth] = useState(() => {
		// Get the number of counts that will be rendered.
		let counts = props.columnFrequencyTable.counts.length;
		if (props.columnFrequencyTable.other_count) {
			counts++;
		}

		// If the number of counts that will be rendered is 0, return 0.
		if (!counts) {
			return 0;
		}

		// Calculate and return the count width.
		return (props.graphWidth - (counts - 1)) / counts;
	});
	const [maxCount] = useState(() => {
		// Find the max count.
		let maxCount = 0;
		for (let i = 0; i < props.columnFrequencyTable.counts.length; i++) {
			const count = props.columnFrequencyTable.counts[i];
			if (count > maxCount) {
				maxCount = count;
			}
		}

		// Account for the other count in the max count.
		const otherCount = props.columnFrequencyTable.other_count ?? 0;
		if (otherCount > maxCount) {
			maxCount = otherCount;
		}

		// Return the max count.
		return maxCount;
	});

	// Calculate total count for percentages
	const totalCount = useMemo(() => {
		return props.columnFrequencyTable.counts.reduce((sum, count) => sum + count, 0) +
			(props.columnFrequencyTable.other_count || 0);
	}, [props.columnFrequencyTable.counts, props.columnFrequencyTable.other_count]);

	// Calculate the positions of each frequency bar
	const positions = useMemo(() => {
		const posArray: number[] = [];
		let x = 0;
		for (let i = 0; i < props.columnFrequencyTable.counts.length; i++) {
			posArray.push(x);
			x += countWidth + 1;
		}
		return posArray;
	}, [props.columnFrequencyTable.counts.length, countWidth]);

	// Render.
	return (
		<svg
			className='vector-frequency-table'
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
				{props.columnFrequencyTable.counts.map((count, countIndex) => {
					const countHeight = Math.max(1, (count / maxCount) * props.graphHeight);
					const value = props.columnFrequencyTable.values[countIndex];
					const countPercent = totalCount > 0 ? ((count / totalCount) * 100).toFixed(1) : '0.0';

					return (
						<FrequencyCount
							key={`frequency-count-${countIndex}`}
							count={count}
							countHeight={countHeight}
							countIndex={countIndex}
							countPercent={countPercent}
							countWidth={countWidth}
							graphHeight={props.graphHeight}
							hoverManager={props.hoverManager}
							value={value}
							xAxisHeight={props.xAxisHeight}
							xPosition={positions[countIndex]}
						/>
					);
				})}
				{props.columnFrequencyTable.other_count && (
					<OtherCount
						graphHeight={props.graphHeight}
						graphWidth={props.graphWidth}
						hoverManager={props.hoverManager}
						maxCount={maxCount}
						otherCount={props.columnFrequencyTable.other_count}
						totalCount={totalCount}
						xAxisHeight={props.xAxisHeight}
						xPosition={positions[positions.length - 1] + countWidth + 1}
					/>
				)}
			</g>
		</svg>
	);
};
