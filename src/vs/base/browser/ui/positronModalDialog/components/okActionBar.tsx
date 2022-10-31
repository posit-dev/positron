/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./okActionBar';

// React Imports
import * as React from 'react';
// React Imports

/**
 * okActionBarProps interface.
 */
interface OKActionBarProps {
	okButtonTitle?: string;
	accept: () => void;
}

/**
 * OKActionBar component.
 * @param props An OKActionBarProps that contains the properties for the component.
 */
export const OKActionBar = (props: OKActionBarProps) => {
	// Render.
	return (
		<div className='ok-action-bar top-separator'>
			<a className='push-button default' tabIndex={0} role='button' onClick={props.accept}>
				OK
			</a>
		</div>
	);
};
