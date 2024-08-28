/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./vectorFrequencyTable';

// React.
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { ColumnFrequencyTable } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

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
				x={x}
				y={props.graphHeight - props.xAxisHeight - countHeight}
				width={props.graphWidth - x}
				height={countHeight}
			/>
		);
	};

	// Render.
	let x = 0;
	return (
		<svg
			className='vector-frequency-table'
			viewBox={`0 0 ${props.graphWidth} ${props.graphHeight + props.xAxisHeight}`}
			shapeRendering='crispEdges'
		>
			<g>
				<rect className='x-axis'
					x={0}
					y={props.graphHeight - props.xAxisHeight}
					width={props.graphWidth}
					height={props.xAxisHeight}
				/>
				{props.columnFrequencyTable.counts.map((count, countIndex) => {
					const countHeight = Math.max(1, (count / maxCount) * props.graphHeight);
					try {
						return (
							<rect
								className='count'
								key={`count-${countIndex}`}
								x={x}
								y={props.graphHeight - props.xAxisHeight - countHeight}
								width={countWidth}
								height={countHeight}
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
