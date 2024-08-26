/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileString';

// React.
import * as React from 'react';

// Other dependencies.
import { StatsValue } from 'vs/workbench/services/positronDataExplorer/browser/components/statsValue';
import { ColumnNullCountValue } from 'vs/workbench/services/positronDataExplorer/browser/components/columnNullCountValue';
import { positronEmpty, positronMissing, positronUnique } from 'vs/workbench/services/positronDataExplorer/common/constants';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { ProfileSparklineFrequencyTable } from 'vs/workbench/services/positronDataExplorer/browser/components/profileSparklineFrequencyTable';

/**
 * Constants.
 */
export const PROFILE_STRING_LINE_COUNT = 3;

/**
 * ProfileStringProps interface.
 */
interface ProfileStringProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ProfileString component.
 * @param props A ProfileStringProps that contains the component properties.
 * @returns The rendered component.
 */
export const ProfileString = (props: ProfileStringProps) => {
	// Get the column profile.
	const columnFrequencyTable = props.instance.getColumnFrequencyTable(props.columnIndex);
	const stats = props.instance.getColumnSummaryStats(props.columnIndex)?.string_stats;

	// Render.
	return (
		<div className='profile-info'>
			<ProfileSparklineFrequencyTable columnFrequencyTable={columnFrequencyTable} />
			<div className='tabular-info'>
				<div className='labels'>
					<div className='label'>{positronMissing}</div>
					<div className='label'>{positronEmpty}</div>
					<div className='label'>{positronUnique}</div>
				</div>
				<div className='values'>
					<ColumnNullCountValue {...props} />
					<StatsValue stats={stats} value={stats?.num_empty} />
					<StatsValue stats={stats} value={stats?.num_unique} />
				</div>
			</div>
		</div>
	);
};
