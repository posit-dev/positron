/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SVGProps } from 'react';

export const PositAi = (props: SVGProps<SVGSVGElement>) => (
	<svg
		height='1em'
		style={{
			flex: 'none',
			lineHeight: 1,
		}}
		viewBox='38.5 -2.7 80 80'
		width='1em'
		xmlns='http://www.w3.org/2000/svg'
		{...props}
	>
		<path d='M77.37,60.07c.66.66,1.73.66,2.39,0l30.06-30.06,5.81,5.81c.66.66.66,1.73,0,2.39l-35.87,35.87c-.66.66-1.73.66-2.39,0l-35.87-35.87c-.66-.66-.66-1.73,0-2.39l5.81-5.81,30.06,30.06Z' fill='currentColor' />
		<path d='M79.71,14.56c-.66-.66-1.73-.66-2.39,0l-16.33,16.33-5.81-5.81c-.66-.66-.66-1.73,0-2.39L77.32.56c.66-.66,1.73-.66,2.39,0l22.22,22.22c.66.66.66,1.73,0,2.39l-5.81,5.81-16.41-16.41Z' fill='currentColor' />
		<rect fill='currentColor' height='15.4' rx='1.82' ry='1.82' transform='translate(-2.9 66.28) rotate(-45)' width='15.4' x='70.86' y='28.95' />
	</svg>
);
export default PositAi;
