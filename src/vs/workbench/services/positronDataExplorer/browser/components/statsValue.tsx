/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './statsValue.css';

// Other dependencies.
import { positronNA } from '../../common/constants.js';

/**
 * StatsValueProps interface.
 */
interface StatsValueProps {
	stats?: any;
	value?: number | string;
}

/**
 * StatsValue component.
 * @param props A StatsValueProps that contains the component properties.
 * @returns The rendered component.
 */
export const StatsValue = (props: StatsValueProps) => {
	// Render placeholder.
	if (props.stats === undefined) {
		return (
			<div className='value-placeholder'>&#x22ef;</div>
		);
	}

	// Render value.
	return (
		<div className='value'>{props.value ?? positronNA}</div>
	);
};
