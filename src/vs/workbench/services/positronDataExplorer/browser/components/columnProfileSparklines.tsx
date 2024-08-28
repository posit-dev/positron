/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnProfileSparklines';

// React.
import * as React from 'react';

// Other dependencies.
import { VectorHistogram } from 'vs/workbench/services/positronDataExplorer/browser/components/vectorHistogram';
import { VectorFrequencyTable } from 'vs/workbench/services/positronDataExplorer/browser/components/vectorFrequencyTable';
import { ColumnFrequencyTable, ColumnHistogram } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

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
				graphWidth={GRAPH_WIDTH}
				graphHeight={GRAPH_HEIGHT}
				xAxisHeight={X_AXIS_HEIGHT}
				columnHistogram={columnHistogram}
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
				graphWidth={GRAPH_WIDTH}
				graphHeight={GRAPH_HEIGHT}
				xAxisHeight={X_AXIS_HEIGHT}
				columnFrequencyTable={columnFrequencyTable}
			/>
		</div >
	);
};
