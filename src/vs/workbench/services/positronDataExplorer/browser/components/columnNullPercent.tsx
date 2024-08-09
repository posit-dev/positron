/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnNullPercent';

// React.
import * as React from 'react';
import { positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * Constants.
 */
const SVG_WIDTH = 50;

/**
 * ColumnNullPercentProps interface.
 */
interface ColumnNullPercentProps {
	columnNullPercent: number;
}

/**
 * ColumnNullPercent component.
 * @param props A ColumnNullPercentProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnNullPercent = (props: ColumnNullPercentProps) => {
	// Calculate the column null percent (and guard against values that are out of range).
	let columnNullPercent;
	if (!props.columnNullPercent || props.columnNullPercent < 0) {
		columnNullPercent = 0;
	} else if (props.columnNullPercent >= 100) {
		columnNullPercent = 100;
	} else {
		columnNullPercent = Math.min(Math.max(props.columnNullPercent, 5), 95);
	}

	// Render.
	return (
		<div className='column-null-percent'>
			{props.columnNullPercent !== undefined ?
				(
					<div className={positronClassNames('text-percent', { 'zero': props.columnNullPercent === 0.0 })}>
						{props.columnNullPercent}%
					</div>
				) :
				(
					<div className={positronClassNames('text-percent')}>
						...
					</div>
				)
			}
			<div className='graph-percent'>
				<svg viewBox='0 0 52 14' shapeRendering='geometricPrecision'>
					<defs>
						<clipPath id='clip-indicator'>
							<rect x='1' y='1' width='50' height='12' rx='6' ry='6' />
						</clipPath>
					</defs>
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
							width={SVG_WIDTH * ((100 - columnNullPercent) / 100)}
							height='12'
							rx='6'
							ry='6'
							clipPath='url(#clip-indicator)'
						/>
					</g>
				</svg>
			</div>
		</div >
	);
};
