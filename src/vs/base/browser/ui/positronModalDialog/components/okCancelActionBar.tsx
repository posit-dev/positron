/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
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
 * @param props An OKCancelActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const OKCancelActionBar = (props: OKCancelActionBarProps) => {
	// Render.
	return (
		<div className='ok-cancel-action-bar top-separator'>
			<button className='button action-bar-button default' tabIndex={0} onClick={props.accept}>
				{props.okButtonTitle ?? localize('positronOK', "OK")}
			</button>
			<button className='button action-bar-button' tabIndex={0} onClick={props.cancel}>
				{props.cancelButtonTitle ?? localize('positronCancel', "Cancel")}
			</button>
		</div>
	);
};
