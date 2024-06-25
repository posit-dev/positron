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
 * PositronDataExplorerClosedProps interface.
 */
export interface PositronDataExplorerClosedProps {
	onClose: () => void;
}

/**
 * PositronDataExplorerClosed component.
 * @param props A PositronDataExplorerClosedProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDataExplorerClosed = (props: PropsWithChildren<PositronDataExplorerClosedProps>) => {
	// Constants.
	const closeDataExplorer = localize(
		'positron.dataExplorerEditor.closeDataExplorer',
		"Close Data Explorer"
	);

	// Render.
	return (
		<div className='positron-data-explorer-closed'>
			<div className='message' >
				<div>
					{(() => localize(
						'positron.dataExplorerEditor.thisObjectIsNoLongerAvailable',
						'This object is no longer available.'
					))()}
				</div>
				<Button
					className='close-button'
					ariaLabel={closeDataExplorer}
					onPressed={props.onClose}
				>
					{closeDataExplorer}
				</Button>
			</div>
		</div>
	);
};
