/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./okCancelActionBar';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';

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
			<Button className='action-bar-button default' onPressed={props.accept}>
				{props.okButtonTitle ?? localize('positronOK', "OK")}
			</Button>
			<Button className='action-bar-button' onPressed={props.cancel}>
				{props.cancelButtonTitle ?? localize('positronCancel', "Cancel")}
			</Button>
		</div>
	);
};
