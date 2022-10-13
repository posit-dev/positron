/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronOKCancelActionBarComponent';
require('react');
import * as React from 'react';

/**
 * PositronOKCancelActionBarComponentProps interface.
 */
interface PositronOKCancelActionBarComponentProps {
	ok: () => void;
	cancel: () => void;
}

/**
 * PositronOKCancelActionBarComponent component.
 * @param props A PositronOKCancelActionBarComponentProps that contains the properties for the component.
 */
export const PositronOKCancelActionBarComponent = (props: PositronOKCancelActionBarComponentProps) => {
	// Render.
	return (
		<div className='ok-action-bar top-separator'>
			<a className='push-button default' tabIndex={0} role='button' onClick={props.ok}>
				OK
			</a>
			<a className='push-button' tabIndex={0} role='button' onClick={props.cancel}>
				Cancel
			</a>
		</div>
	);
};
