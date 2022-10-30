/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./okCancelActionBar';
require('react');
import * as React from 'react';

/**
 * OKCancelActionBarProps interface.
 */
interface OKCancelActionBarProps {
	acceptHandler: () => void;
	cancelHandler: () => void;
}

/**
 * OKCancelActionBar component.
 * @param props An OKCancelActionBarProps that contains the properties for the component.
 */
export const OKCancelActionBar = (props: OKCancelActionBarProps) => {
	// Render.
	return (
		<div className='ok-action-bar top-separator'>
			<a className='push-button default' tabIndex={0} role='button' onClick={props.acceptHandler}>
				OK
			</a>
			<a className='push-button' tabIndex={0} role='button' onClick={props.cancelHandler}>
				Cancel
			</a>
		</div>
	);
};
