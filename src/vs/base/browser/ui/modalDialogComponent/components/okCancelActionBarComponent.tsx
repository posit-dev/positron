/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./okCancelActionBarComponent';
require('react');
import * as React from 'react';

/**
 * OKCancelActionBarComponentProps interface.
 */
interface OKCancelActionBarComponentProps {
	ok: () => void;
	cancel: () => void;
}

/**
 * OKCancelActionBarComponent component.
 * @param props An OKCancelActionBarComponentProps that contains the properties for the component.
 */
export const OKCancelActionBarComponent = (props: OKCancelActionBarComponentProps) => {
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
