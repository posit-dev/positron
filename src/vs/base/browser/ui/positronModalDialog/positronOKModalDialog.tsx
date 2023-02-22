/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
const React = require('react');
import { PropsWithChildren } from 'react';
import { ContentArea } from 'vs/base/browser/ui/positronModalDialog/components/contentArea';
import { OKActionBar } from 'vs/base/browser/ui/positronModalDialog/components/okActionBar';
import { PositronModalDialog, PositronModalDialogProps } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';

/**
 * OKModalDialogProps interface.
 */
export interface OKModalDialogProps extends PositronModalDialogProps {
	title: string;
	okButtonTitle?: string;
	accept: () => void;
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

