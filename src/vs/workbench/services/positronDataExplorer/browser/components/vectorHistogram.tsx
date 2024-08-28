/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./vectorHistogram';

// React.
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { ColumnHistogram } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * VectorHistogramProps interface.
 */
interface VectorHistogramProps {
	readonly graphWidth: number;
	readonly graphHeight: number;
	readonly xAxisHeight: number;
	readonly columnHistogram: ColumnHistogram;
}

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

	// Render.
	return (
		<svg
			className='vector-histogram'
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
				{props.columnHistogram.bin_counts.map((binCount, binCountIndex) => {
					const binCountHeight = (binCount / maxBinCount) * props.graphHeight;
					return (
						<rect
							className='bin-count'
							key={`bin-count-${binCountIndex}`}
							x={binCountIndex * binWidth}
							y={props.graphHeight - props.xAxisHeight - binCountHeight}
							width={binWidth}
							height={binCountHeight}
						/>
					);
				})}
			</g>
		</svg>
	);
};
