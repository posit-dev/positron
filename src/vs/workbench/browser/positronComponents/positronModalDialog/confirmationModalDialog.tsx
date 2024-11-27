/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronModalDialog.css';
import './confirmationModalDialog.css';

// React.
import React, { PropsWithChildren } from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { ContentArea } from './components/contentArea.js';
import { PositronModalDialog, PositronModalDialogProps } from './positronModalDialog.js';

/**
 * ConfirmationModalDialogProps interface.
 */
export interface ConfirmationModalDialogProps extends PositronModalDialogProps {
	title: string;
	secondaryActionTitle?: string;
	secondaryActionDestructive?: boolean;
	primaryActionTitle: string;
	onSecondaryAction: () => (void | Promise<void>);
	onPrimaryAction: () => (void | Promise<void>);
}

/**
 * ConfirmationModalDialog component.
 * @param props A PropsWithChildren<ConfirmationModalDialogProps> that contains the component
 * properties.
 * @returns The rendered component.
 */
export const ConfirmationModalDialog = (props: PropsWithChildren<ConfirmationModalDialogProps>) => {
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
					{props.secondaryActionTitle &&
						<Button
							className={positronClassNames(
								'action-bar-button',
								{ 'destructive': props.secondaryActionDestructive }
							)}
							onPressed={async () => await props.onSecondaryAction()}
						>
							{props.secondaryActionTitle}
						</Button>
					}
					<Button
						className='action-bar-button default'
						onPressed={async () => await props.onPrimaryAction()}
					>
						{props.primaryActionTitle}
					</Button>
				</div>
			</div>
		</PositronModalDialog>
	);
};
