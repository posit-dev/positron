/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronDataExplorerClosed.css';

// React.
import React, { PropsWithChildren } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

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
				<Button
					ariaLabel={closeDataExplorer}
					className='close-button'
					onPressed={props.onClose}
				>
					{closeDataExplorer}
				</Button>
			</div>
		</div>
	);
};
