/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileString';

// React.
import * as React from 'react';

/**
 * ProfileStringProps interface.
 */
interface ProfileStringProps {
}

/**
 * ProfileString component.
 * @param props A ProfileStringProps that contains the component properties.
 * @returns The rendered component.
 */
export const ProfileString = (props: ProfileStringProps) => {
	return (
		<div className='tabular-info'>
			<div className='labels'>
				<div className='label'>NA</div>
				<div className='label'>Empty</div>
				<div className='label'>Unique:</div>
			</div>
			<div className='values'>
				<div className='values-left'>
					<div className='value'>12</div>
					<div className='value'>1</div>
					<div className='value'>4</div>
				</div>
				<div className='values-right'>
					<div className='value'>&nbsp;</div>
					<div className='value'>.51</div>
					<div className='value'>.20</div>
				</div>
			</div>
		</div>
	);
};
