/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./okActionBar';
import * as React from 'react';
import { localize } from 'vs/nls';

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
			<a className='action-bar-button' tabIndex={0} role='button' onClick={props.accept}>
				{props.okButtonTitle ?? localize('positronOK', "OK")}
			</a>
		</div>
	);
};
