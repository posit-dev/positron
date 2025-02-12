/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './vectorFrequencyTable.css';

// React.
import React, { useState } from 'react';

// Other dependencies.
import { ColumnFrequencyTable } from '../../../languageRuntime/common/positronDataExplorerComm.js';

/**
 * VectorFrequencyTableProps interface.
 */
interface VectorFrequencyTableProps {
	readonly graphWidth: number;
	readonly graphHeight: number;
	readonly xAxisHeight: number;
	readonly columnFrequencyTable: ColumnFrequencyTable;
}

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

	/**
	 * OtherCount component.
	 * @param x The X offset.
	 * @returns The rendered component.
	 */
	const OtherCount = ({ x }: { x: number }) => {
		// Safety check.
		if (!props.columnFrequencyTable.other_count) {
			return null;
		}

		// Render.
		const countHeight = (props.columnFrequencyTable.other_count / maxCount) * props.graphHeight;
		return (
			<rect
				className='count other'
				height={countHeight}
				width={props.graphWidth - x}
				x={x}
				y={props.graphHeight - props.xAxisHeight - countHeight}
			/>
		);
	};

	// Render.
	let x = 0;
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
					try {
						return (
							<rect
								key={`count-${countIndex}`}
								className='count'
								height={countHeight}
								width={countWidth}
								x={x}
								y={props.graphHeight - props.xAxisHeight - countHeight}
							/>
						);
					} finally {
						x += countWidth + 1;
					}
				})}
				{props.columnFrequencyTable.other_count && <OtherCount x={x} />}
			</g>
		</svg>
	);
};
