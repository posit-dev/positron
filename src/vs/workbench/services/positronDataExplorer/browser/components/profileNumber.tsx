/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileNumber';

// React.
import * as React from 'react';

/**
 * ProfileNumberProps interface.
 */
interface ProfileNumberProps {
}

/**
 * ProfileNumber component.
 * @param props A ProfileNumberProps that contains the component properties.
 * @returns The rendered component.
 */
export const ProfileNumber = (props: ProfileNumberProps) => {
	return (
		<div className='tabular-info'>
			<div className='labels'>
				<div className='label'>NA</div>
				<div className='label'>Median</div>
				<div className='label'>Mean</div>
				<div className='label'>SD</div>
				<div className='label'>Min</div>
				<div className='label'>Max</div>
			</div>
			<div className='values'>
				<div className='values-left'>
					<div className='value'>12</div>
					<div className='value'>1</div>
					<div className='value'>4</div>
					<div className='value'>2</div>
					<div className='value'>5</div>
					<div className='value'>102</div>
				</div>
				<div className='values-right'>
					<div className='value'>&nbsp;</div>
					<div className='value'>.51</div>
					<div className='value'>.20</div>
					<div className='value'>.24</div>
					<div className='value'>&nbsp;</div>
					<div className='value'>.44</div>
				</div>
			</div>
		</div>
	);
};
