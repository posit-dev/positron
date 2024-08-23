/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileDatetime';

// React.
import * as React from 'react';

// Other dependencies.
import { StatsValue } from 'vs/workbench/services/positronDataExplorer/browser/components/statsValue';
import { ColumnNullCountValue } from 'vs/workbench/services/positronDataExplorer/browser/components/columnNullCountValue';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { positronMax, positronMedian, positronMin, positronMissing, positronTimezone } from 'vs/workbench/services/positronDataExplorer/common/constants';

/**
 * Constants.
 */
export const PROFILE_DATE_TIME_LINE_COUNT = 5;

/**
 * profileDateProps interface.
 */
interface profileDatetimeProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * profileDate component.
 * @param props A ProfileStringProps that contains the component properties.
 * @returns The rendered component.
 */
export const ProfileDatetime = (props: profileDatetimeProps) => {
	// Get the stats.
	const stats = props.instance.getColumnSummaryStats(props.columnIndex)?.datetime_stats;

	// Render.
	return (
		<div className='profile-info'>
			<div className='tabular-info'>
				<div className='labels'>
					<div className='label'>{positronMissing}</div>
					<div className='label'>{positronMin}</div>
					<div className='label'>{positronMedian}</div>
					<div className='label'>{positronMax}</div>
					<div className='label'>{positronTimezone}</div>
				</div>
				<div className='values'>
					<ColumnNullCountValue {...props} />
					<StatsValue stats={stats} value={stats?.min_date} />
					<StatsValue stats={stats} value={stats?.median_date} />
					<StatsValue stats={stats} value={stats?.max_date} />
					<StatsValue stats={stats} value={stats?.timezone} />
				</div>
			</div>
		</div>
	);
};
