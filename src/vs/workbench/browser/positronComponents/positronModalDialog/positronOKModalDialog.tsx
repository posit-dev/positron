/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronModalDialog.css';

// React.
import { PropsWithChildren } from 'react';

// Other dependencies.
import { ContentArea } from './components/contentArea.js';
import { OKActionBar } from './components/okActionBar.js';
import { PositronModalDialog, PositronModalDialogProps } from './positronModalDialog.js';

/**
 * OKModalDialogProps interface.
 */
export interface OKModalDialogProps extends PositronModalDialogProps {
	okButtonTitle?: string;
	onAccept: () => void;
	/**
	 * Not all OK modals should be closeable via the Escape key, as they may require the user to click
	 * the OK button to acknowledge something.
	 * However, this can be optionally specified to allow the modal to be closed via the Escape key.
	 */
	onCancel?: () => void;
}

/**
 * OKModalDialog component.
 * @param props A PropsWithChildren<OKModalDialogProps> that contains the component properties.
 * @returns The rendered component.
 */
export const OKModalDialog = (props: PropsWithChildren<OKModalDialogProps>) => {
	// Render.
	return (
		<PositronModalDialog {...props}>
			<ContentArea>
				{props.children}
			</ContentArea>
			<OKActionBar {...props} />
		</PositronModalDialog>
	);
};

