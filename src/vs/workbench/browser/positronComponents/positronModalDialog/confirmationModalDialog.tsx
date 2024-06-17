/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronModalDialog';
import 'vs/css!./confirmationModalDialog';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { ContentArea } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/contentArea';
import { PositronModalDialog, PositronModalDialogProps } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';

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
