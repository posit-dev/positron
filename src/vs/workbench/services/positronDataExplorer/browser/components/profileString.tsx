/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileString';

// React.
import * as React from 'react';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';

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
	let stats: any = props.instance.getColumnSummaryStats(props.columnIndex)?.string_stats!;
	const nullCount = props.instance.getColumnNullCount(props.columnIndex);
	if (!stats) {
		stats = {};
	}
	return (
		<div className='tabular-info'>
			<div className='labels'>
				<div className='label'>NA</div>
				<div className='label'>Empty</div>
				<div className='label'>Unique:</div>
			</div>
			<div className='values'>
				<div className='values-left'>
					<div className='value'>{nullCount}</div>
					<div className='value'>{stats.num_empty}</div>
					<div className='value'>{stats.num_unique}</div>
				</div>
				{/* <div className='values-right'>
					<div className='value'>&nbsp;</div>
					<div className='value'>.51</div>
					<div className='value'>.20</div>
				</div> */}
			</div>
		</div>
	);
};
