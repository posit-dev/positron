/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
	languageName?: string;
	displayName?: string;
	onClose: () => void;
}

/**
 * PositronDataExplorerClosed component.
 * @param props A PositronDataExplorerClosedProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDataExplorerClosed = (props: PropsWithChildren<PositronDataExplorerClosedProps>) => {
	// Render.
	return (
		<div className='positron-data-explorer-closed'>
			<div className='message' >
				{props.languageName && props.displayName && (
					<>
						<div>
							{(() => localize(
								'positron.dataExplorerEditor.dataDisplayName',
								'{0} Data: {1}',
								props.languageName,
								props.displayName
							))()}
						</div>
						<div>
							{(() => localize(
								'positron.dataExplorerEditor.isNoLongerAvailable',
								'Is no longer available'
							))()}
						</div>
					</>
				)}
				<Button
					className='close-button'
					onPressed={props.onClose}
				>
					{
						(() => localize(
							'positron.dataExplorerEditor.closeDataExplorer',
							"Close Data Explorer"
						))()
					}
				</Button>

			</div>
		</div>
	);
};
