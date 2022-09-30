/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./okActionBarComponent';
const React = require('react');
import { useEffect } from 'react';

/**
 * OKActionBarComponentProps interface.
 */
interface OKActionBarComponentProps {
	done: () => void | undefined;
}

/**
 * OKActionBarComponent component.
 * @param props An OKActionBarComponentProps that contains the properties for the action bar.
 */
export const OKActionBarComponent = (props: OKActionBarComponentProps) => {
	// Hooks.
	useEffect(() => {
	}, []);

	// Render.
	return (
		<div className='ok-action-bar top-separator'>
			<a className='push-button default' tabIndex={0} role='button' onClick={() => props.done()}>
				OK
			</a>
		</div>
	);
};
