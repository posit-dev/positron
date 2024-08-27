/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileBoolean';

// React.
import * as React from 'react';

// Other dependencies.
import { StatsValue } from 'vs/workbench/services/positronDataExplorer/browser/components/statsValue';
import { ColumnNullCountValue } from 'vs/workbench/services/positronDataExplorer/browser/components/columnNullCountValue';
import { positronFalse, positronMissing, positronTrue } from 'vs/workbench/services/positronDataExplorer/common/constants';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { ProfileSparklineFrequencyTable } from 'vs/workbench/services/positronDataExplorer/browser/components/profileSparklineFrequencyTable';

/**
 * Constants.
 */
export const PROFILE_BOOLEAN_LINE_COUNT = 3;

/**
 * ProfileBooleanProps interface.
 */
interface ProfileBooleanProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ProfileBoolean component.
 * @param props A ProfileBooleanProps that contains the component properties.
 * @returns The rendered component.
 */
export const ProfileBoolean = (props: ProfileBooleanProps) => {
	// Get the column profile.
	const columnFrequencyTable = props.instance.getColumnSmallFrequencyTable(props.columnIndex);
	const stats = props.instance.getColumnSummaryStats(props.columnIndex)?.boolean_stats;

	// Render.
	return (
		<div className='profile-info'>
			{columnFrequencyTable && <ProfileSparklineFrequencyTable columnFrequencyTable={columnFrequencyTable} />}
			<div className='tabular-info'>
				<div className='labels'>
					<div className='label'>{positronMissing}</div>
					<div className='label'>{positronTrue}</div>
					<div className='label'>{positronFalse}</div>
				</div>
				<div className='values'>
					<ColumnNullCountValue {...props} />
					<StatsValue stats={stats} value={stats?.true_count} />
					<StatsValue stats={stats} value={stats?.false_count} />
				</div>
			</div>
		</div>
	);
};
