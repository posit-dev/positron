/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnSparklineFrequencyTable';

// React.
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { linearConversion, Range } from 'vs/workbench/services/positronDataExplorer/common/utils';
import { ColumnFrequencyTable } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * Constants.
 */
const GRAPH_WIDTH = 80;
const GRAPH_HEIGHT = 20;
const GRAPH_RANGE: Range = { min: 0, max: GRAPH_HEIGHT };

/**
 * ColumnSparklineFrequencyTableProps interface.
 */
interface ColumnSparklineFrequencyTableProps {
	readonly columnFrequencyTable: ColumnFrequencyTable;
}

/**
 * ColumnSparklineFrequencyTable component.
 * @param columnFrequencyTable The column frequency table.
 * @returns The rendered component.
 */
export const ColumnSparklineFrequencyTable = (
	{ columnFrequencyTable }: ColumnSparklineFrequencyTableProps
) => {
	// State hooks.
	const [countWidth] = useState(() => {
		// Determine the number of counts that will be rendered.
		let counts = columnFrequencyTable.counts.length;
		if (columnFrequencyTable.other_count) {
			counts++;
		}

		// If the number of counts that will be rendered is 0, return 0.
		if (!counts) {
			return 0;
		}

		// Return the count width.
		return (GRAPH_WIDTH - (counts - 1)) / counts;
	});
	const [countRange] = useState((): Range => {
		// Find the maximum count.
		let maxCount = 0;
		for (let i = 0; i < columnFrequencyTable.counts.length; i++) {
			const count = columnFrequencyTable.counts[i];
			if (count > maxCount) {
				maxCount = count;
			}
		}

		// Account for the other count in the maximum count.
		if (columnFrequencyTable.other_count && columnFrequencyTable.other_count > maxCount) {
			maxCount = columnFrequencyTable.other_count;
		}

		// Return the count range.
		return {
			min: 0,
			max: maxCount
		};
	});

	/**
	 * OtherCount component
	 * @returns The rendered component.
	 */
	const OtherCount = () => {
		// Calculate the other count height.
		const otherCountHeight = linearConversion(
			columnFrequencyTable.other_count ?? 0,
			countRange,
			GRAPH_RANGE
		);

		// Render.
		return (
			<rect className='count'
				x={GRAPH_WIDTH - countWidth}
				y={GRAPH_HEIGHT - otherCountHeight}
				width={countWidth}
				height={otherCountHeight}
			/>
		);
	};

	// Render.
	return (
		<div className='sparkline-frequency-table' style={{ width: GRAPH_WIDTH, height: GRAPH_HEIGHT }}>
			<svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} shapeRendering='crispEdges'>
				<g>
					<rect className='bottom-edge'
						x={0}
						y={GRAPH_HEIGHT - 0.5}
						width={GRAPH_WIDTH}
						height={0.5}
					/>
					{columnFrequencyTable.counts.map((count, countIndex) => {
						const countHeight = linearConversion(count, countRange, GRAPH_RANGE);
						return (
							<rect className='count'
								key={`count-${countIndex}`}
								x={(countIndex * countWidth) + countIndex}
								y={GRAPH_HEIGHT - countHeight}
								width={countWidth}
								height={countHeight}
							/>
						);
					})}
					{columnFrequencyTable.other_count && <OtherCount />}
				</g>
			</svg>
		</div >
	);
};
