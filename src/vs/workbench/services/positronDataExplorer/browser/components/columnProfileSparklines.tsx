/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './columnProfileSparklines.css';

// React.
import React from 'react';

// Other dependencies.
import { VectorHistogram } from './vectorHistogram.js';
import { VectorFrequencyTable } from './vectorFrequencyTable.js';
import { ColumnFrequencyTable, ColumnHistogram } from '../../../languageRuntime/common/positronDataExplorerComm.js';

/**
 * Constants.
 */
const GRAPH_WIDTH = 200;
const GRAPH_HEIGHT = 50;
const X_AXIS_HEIGHT = 0.5;

/**
 * ColumnProfileSparklineHistogramProps interface.
 */
interface ColumnProfileSparklineHistogramProps {
	readonly columnHistogram: ColumnHistogram;
}

/**
 * ColumnProfileSparklineHistogram component.
 * @param columnHistogram The column histogram.
 * @returns The rendered component.
 */
export const ColumnProfileSparklineHistogram = ({
	columnHistogram
}: ColumnProfileSparklineHistogramProps) => {
	// Render.
	return (
		<div
			className='column-profile-sparkline'
			style={{
				width: GRAPH_WIDTH,
				height: GRAPH_HEIGHT + X_AXIS_HEIGHT
			}}
		>
			<VectorHistogram
				columnHistogram={columnHistogram}
				graphHeight={GRAPH_HEIGHT}
				graphWidth={GRAPH_WIDTH}
				xAxisHeight={X_AXIS_HEIGHT}
			/>
		</div >
	);
};

/**
 * ColumnProfileSparklineFrequencyTableProps interface.
 */
interface ColumnProfileSparklineFrequencyTableProps {
	readonly columnFrequencyTable: ColumnFrequencyTable;
}

/**
 * ColumnProfileSparklineFrequencyTable component.
 * @param columnFrequencyTable The column frequency table.
 * @returns The rendered component.
 */
export const ColumnProfileSparklineFrequencyTable = ({
	columnFrequencyTable
}: ColumnProfileSparklineFrequencyTableProps) => {
	// Render.
	return (
		<div
			className='column-profile-sparkline'
			style={{
				width: GRAPH_WIDTH,
				height: GRAPH_HEIGHT
			}}
		>
			<VectorFrequencyTable
				columnFrequencyTable={columnFrequencyTable}
				graphHeight={GRAPH_HEIGHT}
				graphWidth={GRAPH_WIDTH}
				xAxisHeight={X_AXIS_HEIGHT}
			/>
		</div >
	);
};
