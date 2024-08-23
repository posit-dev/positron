/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileSparklineHistogram';

// React.
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { linearConversion, Range } from 'vs/workbench/services/positronDataExplorer/common/utils';
import { ColumnHistogram } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * Constants.
 */
const GRAPH_WIDTH = 200;
const GRAPH_HEIGHT = 50;
const X_AXIS_HEIGHT = 0.5;
const GRAPH_RANGE: Range = { min: 0, max: GRAPH_HEIGHT };

/**
 * ProfileSparklineHistogramProps interface.
 */
interface ProfileSparklineHistogramProps {
	readonly columnHistogram?: ColumnHistogram;
}

/**
 * ProfileSparklineHistogram component.
 * @param columnHistogram The column histogram.
 * @returns The rendered component.
 */
export const ProfileSparklineHistogram = ({
	columnHistogram
}: ProfileSparklineHistogramProps) => {
	// State hooks.
	const [binWidth] = useState(() => {
		// Get the number of bin counts that will be rendered.
		const binCounts = columnHistogram?.bin_counts.length;

		// If the number of bin counts that will be rendered is undefined or 0, return 0.
		if (!binCounts) {
			return 0;
		}

		// Return the bin count width.
		return GRAPH_WIDTH / binCounts;
	});
	const [binCountRange] = useState((): Range => {
		// Get the number of bin counts that will be rendered.
		const binCounts = columnHistogram?.bin_counts.length;

		// If the number of bin counts that will be rendered is undefined or 0, return 0.
		if (!binCounts) {
			return {
				min: 0,
				max: 0
			};
		}

		// Find the minimum and maximum bin counts.
		let minBinCount = 0;
		let maxBinCount = 0;
		for (let i = 0; i < binCounts; i++) {
			const binCount = columnHistogram.bin_counts[i];
			if (binCount < minBinCount) {
				minBinCount = binCount;
			}
			if (binCount > maxBinCount) {
				maxBinCount = binCount;
			}
		}

		// Return the bin count range.
		return {
			min: minBinCount,
			max: maxBinCount
		};
	});

	// Render.
	return (
		<div
			className='profile-sparkline-histogram'
			style={{
				width: GRAPH_WIDTH,
				height: GRAPH_HEIGHT + X_AXIS_HEIGHT
			}}
		>
			<svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT + X_AXIS_HEIGHT}`} shapeRendering='crispEdges'>
				<g>
					<rect className='x-axis'
						x={0}
						y={GRAPH_HEIGHT - X_AXIS_HEIGHT}
						width={GRAPH_WIDTH}
						height={X_AXIS_HEIGHT}
					/>
					{columnHistogram && columnHistogram.bin_counts.map((binCount, binIndex) => {
						const binHeight = linearConversion(binCount, binCountRange, GRAPH_RANGE);
						return (
							<rect
								className='bin-count'
								key={`bin-${binIndex}`}
								x={binIndex * binWidth}
								y={GRAPH_HEIGHT - X_AXIS_HEIGHT - binHeight}
								width={binWidth}
								height={binHeight}
							/>
						);
					})}
				</g>
			</svg>
		</div >
	);
};
