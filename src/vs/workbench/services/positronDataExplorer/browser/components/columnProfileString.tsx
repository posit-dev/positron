/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './columnProfileString.css';

// React.
import React from 'react';

// Other dependencies.
import { StatsValue } from './statsValue.js';
import { positronEmpty, positronMissing, positronUnique } from '../../common/constants.js';
import { TableSummaryDataGridInstance } from '../tableSummaryDataGridInstance.js';
import { ColumnProfileNullCountValue } from './columnProfileNullCountValue.js';
import { ColumnProfileSparklineFrequencyTable } from './columnProfileSparklines.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';

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
	hoverService?: IHoverService;
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
				<ColumnProfileSparklineFrequencyTable
					columnFrequencyTable={columnFrequencyTable}
					hoverService={props.hoverService}
				/>
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
