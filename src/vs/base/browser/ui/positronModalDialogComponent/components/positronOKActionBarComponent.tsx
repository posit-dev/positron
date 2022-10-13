/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronOKActionBarComponent';
require('react');
import * as React from 'react';

/**
 * PositronOKActionBarComponentProps interface.
 */
interface PositronOKActionBarComponentProps {
	ok: () => void;
}

/**
 * PositronOKActionBarComponent component.
 * @param props A PositronOKActionBarComponentProps that contains the properties for the component.
 */
export const PositronOKActionBarComponent = (props: PositronOKActionBarComponentProps) => {
	// Render.
	return (
		<div className='ok-action-bar top-separator'>
			<a className='push-button default' tabIndex={0} role='button' onClick={props.ok}>
				OK
			</a>
		</div>
	);
};
