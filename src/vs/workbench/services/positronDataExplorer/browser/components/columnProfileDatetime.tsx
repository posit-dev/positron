/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnProfileDatetime';

// React.
import * as React from 'react';

// Other dependencies.
import { StatsValue } from 'vs/workbench/services/positronDataExplorer/browser/components/statsValue';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { ColumnProfileNullCountValue } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileNullCountValue';
import { positronMax, positronMedian, positronMin, positronMissing, positronTimezone } from 'vs/workbench/services/positronDataExplorer/common/constants';

/**
 * Constants.
 */
export const COLUMN_PROFILE_DATE_TIME_LINE_COUNT = 5;

/**
 * ColumnProfileDatetimeProps interface.
 */
interface ColumnProfileDatetimeProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ColumnProfileDatetime component.
 * @param props A ColumnProfileDatetimeProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnProfileDatetime = (props: ColumnProfileDatetimeProps) => {
	// Render.
	const stats = props.instance.getColumnProfileSummaryStats(props.columnIndex)?.datetime_stats;
	return (
		<div className='column-profile-info'>
			<div className='tabular-info'>
				<div className='labels'>
					<div className='label'>{positronMissing}</div>
					<div className='label'>{positronMin}</div>
					<div className='label'>{positronMedian}</div>
					<div className='label'>{positronMax}</div>
					<div className='label'>{positronTimezone}</div>
				</div>
				<div className='values'>
					<ColumnProfileNullCountValue {...props} />
					<StatsValue stats={stats} value={stats?.min_date} />
					<StatsValue stats={stats} value={stats?.median_date} />
					<StatsValue stats={stats} value={stats?.max_date} />
					<StatsValue stats={stats} value={stats?.timezone} />
				</div>
			</div>
		</div>
	);
};
