/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileNumber';

// React.
import * as React from 'react';

// Other dependencies.
import { StatsValue } from 'vs/workbench/services/positronDataExplorer/browser/components/statsValue';
import { ColumnNullCountValue } from 'vs/workbench/services/positronDataExplorer/browser/components/columnNullCountValue';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { ProfileSparklineHistogram } from 'vs/workbench/services/positronDataExplorer/browser/components/profileSparklineHistogram';
import { positronMax, positronMean, positronMedian, positronMin, positronMissing, positronSD } from 'vs/workbench/services/positronDataExplorer/common/constants';

/**
 * Constants.
 */
export const PROFILE_NUMBER_LINE_COUNT = 6;

/**
 * ProfileNumberProps interface.
 */
interface ProfileNumberProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ProfileNumber component.
 * @param props A ProfileNumberProps that contains the component properties.
 * @returns The rendered component.
 */
export const ProfileNumber = (props: ProfileNumberProps) => {
	// Get the column profile.
	const columnHistogram = props.instance.getColumnSmallHistogram(props.columnIndex);
	const stats = props.instance.getColumnSummaryStats(props.columnIndex)?.number_stats;

	// Render.
	return (
		<div className='profile-info'>
			{columnHistogram && <ProfileSparklineHistogram columnHistogram={columnHistogram} />}
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
					<ColumnNullCountValue {...props} />
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
