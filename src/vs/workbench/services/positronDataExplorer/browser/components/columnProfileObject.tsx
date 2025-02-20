/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './columnProfileObject.css';

// React.
import React from 'react';

// Other dependencies.
import { StatsValue } from './statsValue.js';
import { positronMissing, positronUnique } from '../../common/constants.js';
import { TableSummaryDataGridInstance } from '../tableSummaryDataGridInstance.js';
import { ColumnProfileNullCountValue } from './columnProfileNullCountValue.js';

/**
 * Constants.
 */
export const COLUMN_PROFILE_OBJECT_LINE_COUNT = 3;

/**
 * ColumnProfileObjectProps interface.
 */
interface ColumnProfileObjectProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ColumnProfileObject component.
 * @param props A ColumnProfileObjectProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnProfileObject = (props: ColumnProfileObjectProps) => {
	// Render.
	const stats = props.instance.getColumnProfileSummaryStats(props.columnIndex)?.other_stats;
	return (
		<div className='column-profile-info'>
			<div className='tabular-info'>
				<div className='labels'>
					<div className='label'>{positronMissing}</div>
					<div className='label'>{positronUnique}</div>
				</div>
				<div className='values'>
					<ColumnProfileNullCountValue {...props} />
					<StatsValue stats={stats} value={stats?.num_unique} />
				</div>
			</div>
		</div>
	);
};
