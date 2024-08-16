/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnSparklineHistogram';

// React.
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { linearConversion, Range } from 'vs/workbench/services/positronDataExplorer/common/utils';
import { ColumnHistogram } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * Constants.
 */
const GRAPH_WIDTH = 80;
const GRAPH_HEIGHT = 20;
const GRAPH_RANGE: Range = { min: 0, max: GRAPH_HEIGHT };

/**
 * ColumnSparklineHistogramProps interface.
 */
interface ColumnSparklineHistogramProps {
	readonly columnHistogram: ColumnHistogram;
}

/**
 * ColumnSparklineHistogram component.
 * @param props A ColumnSparklineHistogramProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnSparklineHistogram = (props: ColumnSparklineHistogramProps) => {
	// State hooks.
	const [binCountRange] = useState((): Range => {
		// Find the minimum and maximum bin counts.
		let min = 0;
		let max = 0;
		for (let bin = 0; bin < props.columnHistogram.bin_counts.length; bin++) {
			const binCount = props.columnHistogram.bin_counts[bin];
			if (binCount < min) {
				min = binCount;
			}
			if (binCount > max) {
				max = binCount;
			}
		}

		// Return a range containg the minimum and maximum bin counts.
		return {
			min,
			max
		};
	});

	// Render.
	return (
		<div className='sparkline-histogram' style={{ width: GRAPH_WIDTH, height: GRAPH_HEIGHT }}>
			<svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} shapeRendering='geometricPrecision'>
				<g>
					<rect className='sparkline-area'
						x={0}
						y={GRAPH_HEIGHT - 0.5}
						width={GRAPH_WIDTH}
						height={0.5}
					/>
					{props.columnHistogram.bin_counts.map((binCount, binIndex) => {
						const height = linearConversion(binCount, binCountRange, GRAPH_RANGE);
						return <rect className='sparkline-area'
							key={binIndex}
							x={binIndex}
							y={GRAPH_HEIGHT - height}
							width={1}
							height={height}
						/>;
					})}
				</g>
			</svg>
		</div >
	);
};
