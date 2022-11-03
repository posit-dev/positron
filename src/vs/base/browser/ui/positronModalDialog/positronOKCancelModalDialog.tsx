/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
const React = require('react');
import { PropsWithChildren } from 'react';
import { SimpleTitleBar } from 'vs/base/browser/ui/positronModalDialog/components/simpleTitleBar';
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
 * @param props The properties.
 * @returns The component.
 */
export const OKCancelModalDialog = (props: PropsWithChildren<OKCancelModalDialogProps>) => {
	return (
		<PositronModalDialog {...props}>
			<SimpleTitleBar {...props} />
			<ContentArea>
				{props.children}
			</ContentArea>
			<OKCancelActionBar {...props} />
		</PositronModalDialog>
	);
};

