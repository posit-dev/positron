/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import type { SVGProps } from 'react';

export const Gemini = (props: SVGProps<SVGSVGElement>) => (
	<svg
		height='1em'
		style={{
			flex: 'none',
			lineHeight: 1,
		}}
		viewBox='0 0 24 24'
		width='1em'
		xmlns='http://www.w3.org/2000/svg'
		{...props}
	>
		<defs>
			<linearGradient
				id='gemini-color_svg__a'
				x1='0%'
				x2='68.73%'
				y1='100%'
				y2='30.395%'
			>
				<stop offset='0%' stopColor='#1C7DFF' />
				<stop offset='52.021%' stopColor='#1C69FF' />
				<stop offset='100%' stopColor='#F0DCD6' />
			</linearGradient>
		</defs>
		<path
			d='M12 24A14.3 14.3 0 0 0 0 12 14.3 14.3 0 0 0 12 0a14.305 14.305 0 0 0 12 12 14.305 14.305 0 0 0-12 12'
			fill='url(#gemini-color_svg__a)'
		/>
	</svg>
);
export default Gemini;
