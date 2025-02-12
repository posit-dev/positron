/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './okCancelActionBar.css';

// React.
import React, { ReactElement } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { PlatformNativeDialogActionBar } from './platformNativeDialogActionBar.js';

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
	const okButton = (
		<Button className='action-bar-button default' onPressed={props.onAccept}>
			{props.okButtonTitle ?? localize('positronOK', "OK")}
		</Button>
	);
	const cancelButton = (
		<Button className='action-bar-button' onPressed={props.onCancel}>
			{props.cancelButtonTitle ?? localize('positronCancel', "Cancel")}
		</Button>
	);

	// Render.
	return (
		<div className='ok-cancel-action-bar top-separator'>
			{preActions}
			<PlatformNativeDialogActionBar primaryButton={okButton} secondaryButton={cancelButton} />
		</div>
	);
};
