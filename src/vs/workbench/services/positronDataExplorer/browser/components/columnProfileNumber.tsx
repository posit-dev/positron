/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnProfileNumber';

// React.
import * as React from 'react';

// Other dependencies.
import { StatsValue } from 'vs/workbench/services/positronDataExplorer/browser/components/statsValue';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { ColumnProfileNullCountValue } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileNullCountValue';
import { ColumnProfileSparklineHistogram } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileSparklines';
import { positronMax, positronMean, positronMedian, positronMin, positronMissing, positronSD } from 'vs/workbench/services/positronDataExplorer/common/constants';

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
				<ColumnProfileSparklineHistogram columnHistogram={columnHistogram} />
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
