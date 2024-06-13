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
import { PositronButton } from 'vs/base/browser/ui/positronComponents/button/positronButton';

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
			<PositronButton className='message' onPressed={props.onClose}>
				{props.languageName && props.displayName && (
					<>
						<div
							className='message-line'>
							{(() => localize(
								'positron.dataExplorerEditor.dataDisplayName',
								'{0} Data: {1}',
								props.languageName,
								props.displayName
							))()}
						</div>
						<div
							className='message-line'>
							{(() => localize(
								'positron.dataExplorerEditor.isNoLongerAvailable',
								'Is no longer available'
							))()}
						</div>
					</>
				)}
				<div
					className='message-line'>
					{(() => localize(
						'positron.dataExplorerEditor.clickToClose',
						"Click to close Data Explorer"
					))()}
				</div>
			</PositronButton>
		</div>
	);
};
