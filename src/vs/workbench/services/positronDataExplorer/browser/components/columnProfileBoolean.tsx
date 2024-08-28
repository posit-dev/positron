/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnProfileBoolean';

// React.
import * as React from 'react';

// Other dependencies.
import { StatsValue } from 'vs/workbench/services/positronDataExplorer/browser/components/statsValue';
import { positronFalse, positronMissing, positronTrue } from 'vs/workbench/services/positronDataExplorer/common/constants';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { ColumnProfileNullCountValue } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileNullCountValue';
import { ColumnProfileSparklineFrequencyTable } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileSparklines';

/**
 * Constants.
 */
export const COLUMN_PROFILE_BOOLEAN_LINE_COUNT = 3;

/**
 * ColumnProfileBooleanProps interface.
 */
interface ColumnProfileBooleanProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ColumnProfileBoolean component.
 * @param props A ColumnProfileBooleanProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnProfileBoolean = (props: ColumnProfileBooleanProps) => {
	// Render.
	const columnFrequencyTable = props.instance.getColumnProfileSmallFrequencyTable(props.columnIndex);
	const summaryStats = props.instance.getColumnProfileSummaryStats(props.columnIndex)?.boolean_stats;
	return (
		<div className='column-profile-info'>
			{columnFrequencyTable &&
				<ColumnProfileSparklineFrequencyTable columnFrequencyTable={columnFrequencyTable} />
			}
			<div className='tabular-info'>
				<div className='labels'>
					<div className='label'>{positronMissing}</div>
					<div className='label'>{positronTrue}</div>
					<div className='label'>{positronFalse}</div>
				</div>
				<div className='values'>
					<ColumnProfileNullCountValue {...props} />
					<StatsValue stats={summaryStats} value={summaryStats?.true_count} />
					<StatsValue stats={summaryStats} value={summaryStats?.false_count} />
				</div>
			</div>
		</div>
	);
};
