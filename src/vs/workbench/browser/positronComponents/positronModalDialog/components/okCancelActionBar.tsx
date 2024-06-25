/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./okCancelActionBar';

// React.
import * as React from 'react';

// Other dependencies.
import { ReactElement } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';

/**
 * OKCancelActionBarProps interface.
 * @param okButtonTitle The title of the OK button.
 * @param cancelButtonTitle The title of the Cancel button.
 * @param preActions The pre-actions to render before the OK and cancel buttons.
 * @param onAccept The function to call when the OK button is clicked.
 * @param onCancel The function to call when the Cancel button is clicked.
 */
interface OKCancelActionBarProps {
	okButtonTitle?: string;
	cancelButtonTitle?: string;
	preActions?: () => ReactElement;
	onAccept: () => void;
	onCancel: () => void;
}

/**
 * OKCancelActionBar component.
 * @param props An OKCancelActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const OKCancelActionBar = (props: OKCancelActionBarProps) => {
	const preActions = props.preActions ? props.preActions() : null;
	// Render.
	return (
		<div className='ok-cancel-action-bar top-separator'>
			{preActions}
			<Button className='action-bar-button default' onPressed={props.onAccept}>
				{props.okButtonTitle ?? localize('positronOK', "OK")}
			</Button>
			<Button className='action-bar-button' onPressed={props.onCancel}>
				{props.cancelButtonTitle ?? localize('positronCancel', "Cancel")}
			</Button>
		</div>
	);
};
