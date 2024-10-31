/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataExplorerClosed';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';

/**
 * PositronDataExplorerClosedStatus enum.
 */
export enum PositronDataExplorerClosedStatus {
	UNAVAILABLE = 'unavailable',
	ERROR = 'error'
}

/**
 * PositronDataExplorerClosedProps interface.
 */
export interface PositronDataExplorerClosedProps {
	closedReason: PositronDataExplorerClosedStatus;
	errorMessage?: string;
	onClose: () => void;
}

/**
 * PositronDataExplorerClosed component.
 * @param props A PositronDataExplorerClosedProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDataExplorerClosed = (
	props: PropsWithChildren<PositronDataExplorerClosedProps>
) => {
	// Construct the message and error message.
	let message, errorMessage;
	if (props.closedReason === PositronDataExplorerClosedStatus.ERROR) {
		message = localize(
			'positron.dataExplorerEditor.errorOpeningDataExplorer',
			'Error Opening Data Explorer'
		);
		errorMessage = props.errorMessage;
	} else {
		message = localize(
			'positron.dataExplorerEditor.connectionClosed',
			'Connection Closed'
		);
		errorMessage = localize(
			'positron.dataExplorerEditor.objectNoLongerAvailable',
			'This object is no longer available.'
		);
	}

	// Localize the close button.
	const closeDataExplorer = localize(
		'positron.dataExplorerEditor.closeDataExplorer',
		"Close Data Explorer"
	);

	// Render.
	return (
		<div className='positron-data-explorer-closed'>
			<div className='dialog-box' >
				<div className='message'>
					{message}
				</div>
				<div className='error-message'>
					{errorMessage}
				</div>
				<Button className='close-button'
					ariaLabel={closeDataExplorer}
					onPressed={props.onClose}
				>
					{closeDataExplorer}
				</Button>
			</div>
		</div>
	);
};
