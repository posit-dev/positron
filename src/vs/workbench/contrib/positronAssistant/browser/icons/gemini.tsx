/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
		<path
			d='M12 24A14.3 14.3 0 0 0 0 12 14.3 14.3 0 0 0 12 0a14.305 14.305 0 0 0 12 12 14.305 14.305 0 0 0-12 12'
			fill='#1C7DFF'
		/>
	</svg>
);
export default Gemini;
