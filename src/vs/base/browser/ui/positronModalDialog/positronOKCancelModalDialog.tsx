/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
const React = require('react');
import { PropsWithChildren } from 'react';
import { ContentArea } from 'vs/base/browser/ui/positronModalDialog/components/contentArea';
import { OKCancelActionBar } from 'vs/base/browser/ui/positronModalDialog/components/okCancelActionBar';
import { PositronModalDialog, PositronModalDialogProps } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';

/**
 * OKCancelModalDialogProps interface.
 */
export interface OKCancelModalDialogProps extends PositronModalDialogProps {
	title: string;
	okButtonTitle?: string;
	cancelButtonTitle?: string;
	accept: () => void;
	cancel: () => void;
}

/**
 * OKCancelModalDialog component.
 * @param props A PropsWithChildren<OKCancelModalDialogProps> that contains the component properties.
 * @returns The rendered component.
 */
export const OKCancelModalDialog = (props: PropsWithChildren<OKCancelModalDialogProps>) => {
	// Render.
	return (
		<PositronModalDialog {...props}>
			<ContentArea>
				{props.children}
			</ContentArea>
			<OKCancelActionBar {...props} />
		</PositronModalDialog>
	);
};

