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
import { positronMax, positronMean, positronMedian, positronMin, positronMissing, positronSD } from '../../common/constants.js';

/**
 * Constants.
 */
export const COLUMN_PROFILE_NUMBER_LINE_COUNT = 6;

/**
 * ColumnProfileNumberProps interface.
 */
interface ColumnProfileNumberProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ColumnProfileNumber component.
 * @param props A ColumnProfileNumberProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnProfileNumber = (props: ColumnProfileNumberProps) => {
	// Render.
	const columnHistogram = props.instance.getColumnProfileLargeHistogram(props.columnIndex);
	const stats = props.instance.getColumnProfileSummaryStats(props.columnIndex)?.number_stats;
	return (
		<div className='column-profile-info'>
			{columnHistogram &&
				<ColumnProfileSparklineHistogram
					columnHistogram={columnHistogram}
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
					<StatsValue stats={stats} value={stats?.min_value} />
					<StatsValue stats={stats} value={stats?.median} />
					<StatsValue stats={stats} value={stats?.mean} />
					<StatsValue stats={stats} value={stats?.max_value} />
					<StatsValue stats={stats} value={stats?.stdev} />
				</div>
			</div>
		</div>
	);
};
