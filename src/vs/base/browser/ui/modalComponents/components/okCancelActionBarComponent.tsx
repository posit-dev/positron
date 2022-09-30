/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./okCancelActionBarComponent';
const React = require('react');

/**
 * OKCancelActionBarComponentProps interface.
 */
interface OKCancelActionBarComponentProps {
	done: () => void | undefined;
}

/**
 * OKCancelActionBarComponent component.
 * @param props An OKCancelActionBarComponentProps that contains the properties for the action bar.
 */
export const OKCancelActionBarComponent = (props: OKCancelActionBarComponentProps) => {
	// Render.
	return (
		<div className='ok-action-bar top-separator'>
			<a className='push-button default' tabIndex={0} role='button' onClick={() => props.done()}>
				OK
			</a>
			<a className='push-button' tabIndex={0} role='button' onClick={() => props.done()}>
				Cancel
			</a>
		</div>
	);
};
