/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnProfileString';

// React.
import * as React from 'react';

// Other dependencies.
import { StatsValue } from 'vs/workbench/services/positronDataExplorer/browser/components/statsValue';
import { positronEmpty, positronMissing, positronUnique } from 'vs/workbench/services/positronDataExplorer/common/constants';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { ColumnProfileNullCountValue } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileNullCountValue';
import { ColumnProfileSparklineFrequencyTable } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileSparklines';

/**
 * Constants.
 */
export const COLUMN_PROFILE_STRING_LINE_COUNT = 3;

/**
 * ColumnProfileStringProps interface.
 */
interface ColumnProfileStringProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ColumnProfileString component.
 * @param props A ColumnProfileStringProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnProfileString = (props: ColumnProfileStringProps) => {
	// Render.
	const columnFrequencyTable = props.instance.getColumnProfileLargeFrequencyTable(props.columnIndex);
	const stats = props.instance.getColumnProfileSummaryStats(props.columnIndex)?.string_stats;
	return (
		<div className='column-profile-info'>
			{columnFrequencyTable &&
				<ColumnProfileSparklineFrequencyTable columnFrequencyTable={columnFrequencyTable} />
			}
			<div className='tabular-info'>
				<div className='labels'>
					<div className='label'>{positronMissing}</div>
					<div className='label'>{positronEmpty}</div>
					<div className='label'>{positronUnique}</div>
				</div>
				<div className='values'>
					<ColumnProfileNullCountValue {...props} />
					<StatsValue stats={stats} value={stats?.num_empty} />
					<StatsValue stats={stats} value={stats?.num_unique} />
				</div>
			</div>
		</div>
	);
};
