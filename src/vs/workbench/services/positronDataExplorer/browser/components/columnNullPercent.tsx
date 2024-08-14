/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnNullPercent';

// React.
import * as React from 'react';

// Other dependencies.
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';

/**
 * Constants.
 */
const SVG_WIDTH = 50;

/**
 * ColumnNullPercentProps interface.
 */
interface ColumnNullPercentProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ColumnNullPercent component.
 * @param props A ColumnNullPercentProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnNullPercent = (props: ColumnNullPercentProps) => {
	// Set the column null percent and graph null percent.
	let columnNullPercent = props.instance.getColumnNullPercent(props.columnIndex);
	let graphNullPercent = columnNullPercent;
	if (columnNullPercent !== undefined) {
		if (columnNullPercent <= 0) {
			columnNullPercent = graphNullPercent = 0;
		} else if (columnNullPercent >= 100) {
			columnNullPercent = graphNullPercent = 100;
		} else {
			// Pin the graph null percent such that anything below 5% reads as 5% and anything above
			// 95% reads as 95%.
			graphNullPercent = Math.min(Math.max(columnNullPercent, 5), 95);
		}
	}

	// Render.
	return (
		<div className='column-null-percent'>
			{columnNullPercent !== undefined &&
				<div className={positronClassNames('text-percent', { 'zero': columnNullPercent === 0 })}>
					{columnNullPercent}%
				</div>
			}
			<div className='graph-percent'>
				<svg viewBox='0 0 52 14' shapeRendering='geometricPrecision'>
					<defs>
						<clipPath id='clip-indicator'>
							<rect x='1' y='1' width='50' height='12' rx='6' ry='6' />
						</clipPath>
					</defs>
					{graphNullPercent === undefined ?
						<g>
							<rect className='empty'
								x='1'
								y='1'
								width='50'
								height='12'
								rx='6'
								ry='6'
								strokeWidth='1'
							/>
						</g> :
						<g>
							<rect className='background'
								x='1'
								y='1'
								width='50'
								height='12'
								rx='6'
								ry='6'
								strokeWidth='1'
							/>
							<rect className='indicator'
								x='1'
								y='1'
								width={SVG_WIDTH * ((100 - graphNullPercent) / 100)}
								height='12'
								rx='6'
								ry='6'
								clipPath='url(#clip-indicator)'
							/>
						</g>
					}
				</svg>
			</div>
		</div >
	);
};
