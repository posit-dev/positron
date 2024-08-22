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
const GRAPH_RANGE: Range = { min: 0, max: GRAPH_WIDTH };

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
export const ColumnSparklineFrequencyTable = ({
	columnFrequencyTable
}: ColumnSparklineFrequencyTableProps) => {
	// State hooks.
	const [countRange] = useState((): Range => {
		// Add the counts.
		let max = 0;
		for (let i = 0; i < columnFrequencyTable.counts.length; i++) {
			max += columnFrequencyTable.counts[i];
		}

		// Add the other count.
		if (columnFrequencyTable.other_count) {
			max += columnFrequencyTable.other_count;
		}

		// Return the count range.
		return {
			min: 0,
			max
		};
	});

	// Render.
	let x = 0;
	return (
		<div className='sparkline-frequency-table' style={{ width: GRAPH_WIDTH, height: GRAPH_HEIGHT }}>
			<svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} shapeRendering='crispEdges'>
				<g>
					{columnFrequencyTable.counts.map((count, countIndex) => {
						const countWidth = Math.max(
							1,
							linearConversion(count, countRange, GRAPH_RANGE)
						);
						try {
							return (
								<rect
									className='count'
									key={`count-${countIndex}`}
									x={x}
									y={0}
									width={countWidth}
									height={GRAPH_HEIGHT}
								/>
							);
						} finally {
							x += countWidth + 1;
						}
					})}
					{columnFrequencyTable.other_count &&
						<rect className='count other'
							x={x}
							y={0}
							width={GRAPH_WIDTH - x}
							height={GRAPH_HEIGHT}
						/>
					}
				</g>
			</svg>
		</div >
	);
};
