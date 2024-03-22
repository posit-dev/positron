/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';

export function NotebookCellSkeleton({ actionBarItems, onDelete, children }: {
	actionBarItems: React.ReactNode;
	onDelete: () => void;
	children: React.ReactNode;
}) {
	return (
		<div className='positron-notebook-cell'>
			<div className='action-bar'>
				{actionBarItems}
				<Button
					className='action-button'
					ariaLabel={localize('deleteCell', 'Delete cell')}
					onPressed={() => onDelete()}
				>
					<div className='button-icon codicon codicon-trash' />
				</Button>
			</div>
			<div className='cell-contents'>
				{children}
			</div>
		</div>
	);
}
