/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileNumber';

// React.
import * as React from 'react';

import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';

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
	// Hack
	let stats: any = props.instance.getColumnSummaryStats(props.columnIndex)?.number_stats!;
	if (!stats) {
		stats = {};
	}
	return (
		<div className='tabular-info'>
			<div className='labels'>
				<div className='label'>NA</div>
				<div className='label'>Mean</div>
				<div className='label'>Median</div>
				<div className='label'>SD</div>
				<div className='label'>Min</div>
				<div className='label'>Max</div>
			</div>
			<div className='values'>
				<div className='values-left'>
					<div className='value'>-999999</div>
					<div className='value'>{stats.mean}</div>
					<div className='value'>{stats.median}</div>
					<div className='value'>{stats.stdev}</div>
					<div className='value'>{stats.min_value}</div>
					<div className='value'>{stats.max_value}</div>
				</div>
				{/* <div className='values-right'>
					<div className='value'>&nbsp;</div>
					<div className='value'>.51</div>
					<div className='value'>.20</div>
					<div className='value'>.24</div>
					<div className='value'>&nbsp;</div>
					<div className='value'>.44</div>
				</div> */}
			</div>
		</div>
	);
};
