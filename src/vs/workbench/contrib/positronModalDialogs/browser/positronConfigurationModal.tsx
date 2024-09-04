/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronModalDialogProps, PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import * as React from 'react';
import { OKCancelActionBar } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/okCancelActionBar';

export enum PositronConfigurationModalOptionType {
	String = 'string',
	Number = 'number',
}

export interface PositronConfigurationModalOption {
	// Name of the option that will appear on it's side
	name: string;
	// Option type, will define the type of the box
	type: PositronConfigurationModalOptionType;
	// Default value for the option
	default?: number | string;
}

export interface PositronConfigurationModalOptions extends PositronModalDialogProps {
	options: Array<PositronConfigurationModalOption>;
}

export const PositronConfigurationModal = (props: PositronConfigurationModalOptions) => {
	return (
		<PositronModalDialog renderer={props.renderer} title={props.title} width={400} height={200}
			onAccept={props.onAccept} onCancel={props.onCancel}>
			<p>Hello world</p>
			<OKCancelActionBar
				okButtonTitle={'Ok'}
				cancelButtonTitle={'Cancel'}
				onAccept={props.onAccept}
				onCancel={() => {
					if (props.onCancel) {
						props.onCancel();
					}
				}} />
		</PositronModalDialog>
	);
};







