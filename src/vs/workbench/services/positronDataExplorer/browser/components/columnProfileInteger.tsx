/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './columnProfileNumber.css';

// React.
import React from 'react';

// Other dependencies.
import { StatsValue } from './statsValue.js';
import { TableSummaryDataGridInstance } from '../tableSummaryDataGridInstance.js';
import { ColumnProfileNullCountValue } from './columnProfileNullCountValue.js';
import { ColumnProfileSparklineHistogram } from './columnProfileSparklines.js';
import { positronMax, positronMean, positronMedian, positronMin, positronMissing, positronNA, positronSD } from '../../common/constants.js';

/**
 * Constants.
 */
export const COLUMN_PROFILE_INTEGER_LINE_COUNT = 6;

/**
 * IntegerStatsValue component for formatting integer values.
 */
const IntegerStatsValue = ({ stats, value }: { stats?: any; value?: number | string }) => {
	// Render placeholder.
	if (stats === undefined) {
		return (
			<div className='value-placeholder'>&#x22ef;</div>
		);
	}

	// Format value as integer if it's a number
	let displayValue: string;
	if (value === undefined || value === null) {
		displayValue = positronNA;
	} else if (typeof value === 'number') {
		// Round to nearest integer and format without thousands separator
		displayValue = Math.round(value).toString();
	} else {
		// Already a string, try to parse and format as integer
		const num = parseFloat(value);
		displayValue = isNaN(num) ? value : Math.round(num).toString();
	}

	// Render value.
	return (
		<div className='value'>{displayValue}</div>
	);
};

/**
 * ColumnProfileIntegerProps interface.
 */
interface ColumnProfileIntegerProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ColumnProfileInteger component.
 * @param props A ColumnProfileIntegerProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnProfileInteger = (props: ColumnProfileIntegerProps) => {
	// Render.
	const columnHistogram = props.instance.getColumnProfileLargeHistogram(props.columnIndex);
	const stats = props.instance.getColumnProfileSummaryStats(props.columnIndex)?.number_stats;
	const columnSchema = props.instance.getColumnSchema(props.columnIndex);

	return (
		<div className='column-profile-info'>
			{columnHistogram &&
				<ColumnProfileSparklineHistogram
					columnHistogram={columnHistogram}
					displayType={columnSchema?.type_display}
					hoverManager={props.instance.hoverManager}
				/>
			}
			<div className='tabular-info'>
				<div className='labels'>
					<div className='label'>{positronMissing}</div>
					<div className='label'>{positronMin}</div>
					<div className='label'>{positronMedian}</div>
					<div className='label'>{positronMean}</div>
					<div className='label'>{positronMax}</div>
					<div className='label'>{positronSD}</div>
				</div>
				<div className='values'>
					<ColumnProfileNullCountValue {...props} />
					<IntegerStatsValue stats={stats} value={stats?.min_value} />
					{/* Use StatsValue for median since it can be a decimal for even-length sequences */}
					<StatsValue stats={stats} value={stats?.median} />
					{/* Use StatsValue for mean to handle cases where mean is not an integer */}
					<StatsValue stats={stats} value={stats?.mean} />
					<IntegerStatsValue stats={stats} value={stats?.max_value} />
					{/* Use StatsValue for stdev to handle cases where stdev is not an integer */}
					<StatsValue stats={stats} value={stats?.stdev} />
				</div>
			</div>
		</div>
	);
};
