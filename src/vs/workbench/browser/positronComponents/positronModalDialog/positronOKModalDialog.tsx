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
import { OKActionBar } from './components/okActionBar.js';
import { PositronModalDialog, PositronModalDialogProps } from './positronModalDialog.js';

/**
 * OKModalDialogProps interface.
 */
export interface OKModalDialogProps extends PositronModalDialogProps {
	okButtonTitle?: string;
	onAccept: () => void;
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

