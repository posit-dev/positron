/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronModalDialog.css';
import './confirmDeleteModalDialog.css';

// React.
import React, { PropsWithChildren } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { ContentArea } from './components/contentArea.js';
import { PositronModalDialog, PositronModalDialogProps } from './positronModalDialog.js';
import { PlatformNativeDialogActionBar } from './components/platformNativeDialogActionBar.js';

/**
 * ConfirmDeleteModalDialogProps interface.
 */
export interface ConfirmDeleteModalDialogProps extends PositronModalDialogProps {
	title: string;
	cancelButtonTitle?: string;
	deleteActionTitle?: string
	onCancel: () => (void | Promise<void>);
	onDeleteAction: () => (void | Promise<void>);
}

/**
 * ConfirmDeleteModalDialog component.
 * @param props A PropsWithChildren<ConfirmDeleteModalDialogProps> that contains the component
 * properties.
 * @returns The rendered component.
 */
export const ConfirmDeleteModalDialog = (props: PropsWithChildren<ConfirmDeleteModalDialogProps>) => {
	const cancelButton = (
		<Button
			className='action-bar-button'
			onPressed={async () => await props.onCancel()}
		>
			{props.cancelButtonTitle ?? localize('positron.cancel', "Cancel")}
		</Button>
	);
	const deleteButton = (
		<Button
			className='action-bar-button default'
			onPressed={async () => await props.onDeleteAction()}
		>
			{props.deleteActionTitle ?? localize('positron.delete', "Delete")}
		</Button>
	);

	// Render.
	return (
		<PositronModalDialog {...props}>
			<ContentArea>
				{props.children}
			</ContentArea>
			<div className='action-bar top-separator'>
				<div className='left-actions'>
				</div>
				<div className='right-actions'>
					<PlatformNativeDialogActionBar primaryButton={deleteButton} secondaryButton={cancelButton} />
				</div>
			</div>
		</PositronModalDialog>
	);
};
