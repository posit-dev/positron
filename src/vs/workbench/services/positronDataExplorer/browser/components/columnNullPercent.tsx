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
	props.columnNullPercent = Math.floor(Math.random() * 101);
	if (props.columnNullPercent < 10) {
		props.columnNullPercent = 0.0;
	}

	// Render.
	return (
		<div className='column-null-percent'>
			<div className={positronClassNames('text-percent', { 'zero': props.columnNullPercent === 0.0 })}>
				{props.columnNullPercent}%
			</div>
			<div className='graph-percent'>
				<svg viewBox='0 0 52 14' shapeRendering='geometricPrecision'>
					<g>
						<rect
							x='1'
							y='1'
							width='50'
							height='12'
							rx='6'
							ry='6'
							fill='#ea3d3d'
							stroke='#7e94a5'
							strokeWidth='1'
						/>
						<rect
							x='1'
							y='1'
							width={props.columnNullPercent === 0.0 ?
								50 :
								Math.max(50 * ((100 - props.columnNullPercent) / 100), 3)
							}
							height='12'
							rx='6'
							ry='6'
							fill='#e5edf3'
						/>
					</g>
				</svg>
			</div>
		</div >
	);
};
