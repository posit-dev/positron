/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronModalDialog';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { ContentArea } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/contentArea';
import { OKActionBar } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/okActionBar';
import { PositronModalDialog, PositronModalDialogProps } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';

/**
 * OKModalDialogProps interface.
 */
export interface OKModalDialogProps extends PositronModalDialogProps {
	title: string;
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

