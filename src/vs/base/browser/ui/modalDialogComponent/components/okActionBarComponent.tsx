/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./okActionBarComponent';
require('react');
import * as React from 'react';

/**
 * OKActionBarComponentProps interface.
 */
interface OKActionBarComponentProps {
	ok: () => void | undefined;
}

/**
 * OKActionBarComponent component.
 * @param props An OKActionBarComponentProps that contains the properties for the action bar.
 */
export const OKActionBarComponent = (props: OKActionBarComponentProps) => {
	// Render.
	return (
		<div className='ok-action-bar top-separator'>
			<a className='push-button default' tabIndex={0} role='button' onClick={props.ok}>
				OK
			</a>
		</div>
	);
};
