/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useId, type SVGProps } from 'react';

const SPARK = 'M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z';

export const Geap = (props: SVGProps<SVGSVGElement>) => {
	// Unique per instance so the gradients still resolve when this icon renders
	// more than once (the provider list stays mounted while a detail view shows
	// the same icon). Shared static ids collide, and the first match -- if it
	// lives in a display:none subtree -- paints nothing.
	const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
	const green = `geap-spark-green-${uid}`;
	const red = `geap-spark-red-${uid}`;
	const yellow = `geap-spark-yellow-${uid}`;
	return (
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
			<title>Gemini Enterprise Agent Platform</title>
			<path d={SPARK} fill='#3186FF' />
			<path d={SPARK} fill={`url(#${green})`} />
			<path d={SPARK} fill={`url(#${red})`} />
			<path d={SPARK} fill={`url(#${yellow})`} />
			<defs>
				<linearGradient gradientUnits='userSpaceOnUse' id={green} x1='7' x2='11' y1='15.5' y2='12'>
					<stop stopColor='#08B962' />
					<stop offset='1' stopColor='#08B962' stopOpacity='0' />
				</linearGradient>
				<linearGradient gradientUnits='userSpaceOnUse' id={red} x1='8' x2='11.5' y1='5.5' y2='11'>
					<stop stopColor='#F94543' />
					<stop offset='1' stopColor='#F94543' stopOpacity='0' />
				</linearGradient>
				<linearGradient gradientUnits='userSpaceOnUse' id={yellow} x1='3.5' x2='17.5' y1='13.5' y2='12'>
					<stop stopColor='#FABC12' />
					<stop offset='.46' stopColor='#FABC12' stopOpacity='0' />
				</linearGradient>
			</defs>
		</svg>
	);
};
export default Geap;
