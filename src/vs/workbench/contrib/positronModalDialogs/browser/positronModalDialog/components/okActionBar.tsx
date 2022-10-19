/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./okActionBar';
require('react');
import * as React from 'react';

/**
 * okActionBarProps interface.
 */
interface OKActionBarProps {
	ok: () => void;
}

/**
 * OKActionBar component.
 * @param props An OKActionBarProps that contains the properties for the component.
 */
export const OKActionBar = (props: OKActionBarProps) => {
	// Render.
	return (
		<div className='ok-action-bar top-separator'>
			<a className='push-button default' tabIndex={0} role='button' onClick={props.ok}>
				OK
			</a>
		</div>
	);
};
