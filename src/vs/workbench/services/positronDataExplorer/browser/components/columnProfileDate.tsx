/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnProfileDate';

// React.
import * as React from 'react';

// Other dependencies.
import { StatsValue } from 'vs/workbench/services/positronDataExplorer/browser/components/statsValue';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { ColumnProfileNullCountValue } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileNullCountValue';
import { positronMax, positronMedian, positronMin, positronMissing } from 'vs/workbench/services/positronDataExplorer/common/constants';

/**
 * Constants.
 */
export const COLUMN_PROFILE_DATE_LINE_COUNT = 4;

/**
 * ColumnProfileDateProps interface.
 */
interface ColumnProfileDateProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ColumnProfileDate component.
 * @param props A ColumnProfileDateProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnProfileDate = (props: ColumnProfileDateProps) => {
	// Render.
	const stats = props.instance.getColumnProfileSummaryStats(props.columnIndex)?.date_stats;
	return (
		<div className='column-profile-info'>
			<div className='tabular-info'>
				<div className='labels'>
					<div className='label'>{positronMissing}</div>
					<div className='label'>{positronMin}</div>
					<div className='label'>{positronMedian}</div>
					<div className='label'>{positronMax}</div>
				</div>
				<div className='values'>
					<ColumnProfileNullCountValue {...props} />
					<StatsValue stats={stats} value={stats?.min_date} />
					<StatsValue stats={stats} value={stats?.median_date} />
					<StatsValue stats={stats} value={stats?.max_date} />
				</div>
			</div>
		</div>
	);
};
