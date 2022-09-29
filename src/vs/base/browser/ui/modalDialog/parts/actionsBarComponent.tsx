/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionsBarComponent';
const React = require('react');

/**
 * ActionsBarComponentProps interface.
 */
interface ActionsBarComponentProps {
	done: () => void | undefined;
}

/**
 * ActionsBarComponent component.
 * @param props An ActionsBarComponentProps that contains the properties for the actions bar.
 */
export const ActionsBarComponent = (props: ActionsBarComponentProps) => {
	// Render.
	return (
		<div className='actions-bar top-separator'>
			<a className='push-button' tabIndex={0} role='button' onClick={() => props.done()}>
				OK
			</a>
		</div>
	);
};
