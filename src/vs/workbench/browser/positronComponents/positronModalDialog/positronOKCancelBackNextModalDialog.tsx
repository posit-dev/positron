/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
const React = require('react');
import { PropsWithChildren } from 'react';
import { ContentArea } from 'vs/base/browser/ui/positronModalDialog/components/contentArea';
import { OKCancelBackNextActionBar } from 'vs/base/browser/ui/positronModalDialog/components/okCancelBackNextActionBar';
import { PositronModalDialog, PositronModalDialogProps } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';

/**
 * OKCancelBackNextModalDialog interface.
 */
export interface OKCancelBackNextModalDialogProps extends PositronModalDialogProps {
	title: string;
	okButtonTitle?: string;
	cancelButtonTitle?: string;
	backButtonTitle?: string;
	nextButtonTitle?: string;
	hideOkButton?: boolean;
	hideCancelButton?: boolean;
	hideBackButton?: boolean;
	hideNextButton?: boolean;
	accept: () => void;
	cancel: () => void;
	back: () => void;
	next: () => void;
}

/**
 * OKCancelBackNextModalDialog component.
 * @param props A PropsWithChildren<OKCancelBackNextModalDialogProps> that contains the component properties.
 * @returns The rendered component.
 */
export const OKCancelBackNextModalDialog = (props: PropsWithChildren<OKCancelBackNextModalDialogProps>) => {
	// Render.
	return (
		<PositronModalDialog {...props}>
			<ContentArea>
				{props.children}
			</ContentArea>
			<OKCancelBackNextActionBar {...props} />
		</PositronModalDialog>
	);
};

