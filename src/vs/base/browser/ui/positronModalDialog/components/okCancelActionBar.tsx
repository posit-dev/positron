/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./okCancelActionBar';
import * as React from 'react';
import { localize } from 'vs/nls';

/**
 * OKCancelActionBarProps interface.
 */
interface OKCancelActionBarProps {
	okButtonTitle?: string;
	cancelButtonTitle?: string;
	accept: () => void;
	cancel: () => void;
}

/**
 * OKCancelActionBar component.
 * @param props An OKCancelActionBarProps that contains the properties for the component.
 */
export const OKCancelActionBar = (props: OKCancelActionBarProps) => {
	// Render.
	return (
		<div className='ok-action-bar top-separator'>
			<a className='push-button default' tabIndex={0} role='button' onClick={props.accept}>
				{props.okButtonTitle ?? localize('positronOK', "OK")}
			</a>
			<a className='push-button' tabIndex={0} role='button' onClick={props.cancel}>
				{props.cancelButtonTitle ?? localize('positronCancel', "Cancel")}
			</a>
		</div>
	);
};
