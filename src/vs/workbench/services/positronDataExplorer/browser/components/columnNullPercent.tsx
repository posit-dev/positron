/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnNullPercent';

// React.
import * as React from 'react';
import { positronClassNames } from 'vs/base/common/positronUtilities';

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
	// Render.
	return (
		<div className='column-null-percent'>
			<div className={positronClassNames('text-percent', { 'zero': props.columnNullPercent === 0.0 })}>
				{props.columnNullPercent}%
			</div>
			<div className='graph-percent'>
				<svg viewBox='0 0 52 14' shapeRendering='geometricPrecision'>
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
							width={props.columnNullPercent === 0.0 ?
								50 :
								Math.max(50 * ((100 - props.columnNullPercent) / 100), 3)
							}
							height='12'
							rx='6'
							ry='6'
						/>
					</g>
				</svg>
			</div>
		</div >
	);
};
