/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronModalDialog.css';

// React.
import React, { PropsWithChildren } from 'react';

// Other dependencies.
import { ContentArea } from './components/contentArea.js';
import { OKCancelActionBar } from './components/okCancelActionBar.js';
import { PositronModalDialog, PositronModalDialogProps } from './positronModalDialog.js';
import { VerticalSpacer } from './components/verticalSpacer.js';

/**
 * OKCancelModalDialogProps interface.
 */
export interface OKCancelModalDialogProps extends PositronModalDialogProps {
	title: string;
	okButtonTitle?: string;
	cancelButtonTitle?: string;
	onAccept: () => (void | Promise<void>);
	onCancel: () => (void | Promise<void>);
	/**
	 * Should the callbacks be wrapped in try-catch blocks that optionally forward the error to the
	 * popup?
	 */
	catchErrors?: boolean;
}

/**
 * OKCancelModalDialog component.
 * @param props A PropsWithChildren<OKCancelModalDialogProps> that contains the component properties.
 * @returns The rendered component.
 */
export const OKCancelModalDialog = (props: PropsWithChildren<OKCancelModalDialogProps>) => {
	// Potential error message from submission attempt.
	const [errorMsg, setErrorMsg] = React.useState<string | undefined>(undefined);

	const { catchErrors, onAccept, children, ...otherProps } = props;

	const fullProps = {
		...otherProps,
		onAccept: catchErrors ? async () => {
			try { await onAccept(); }
			catch (err) { setErrorMsg(err.message); }
		} : onAccept,
	};

	// Render.
	return (
		<PositronModalDialog {...fullProps}>
			<ContentArea>
				{children}
				{errorMsg ?
					<VerticalSpacer>
						<p className='error-msg'>{errorMsg}</p>
					</VerticalSpacer> :
					null
				}
			</ContentArea>
			<OKCancelActionBar {...fullProps} />
		</PositronModalDialog>
	);
};

