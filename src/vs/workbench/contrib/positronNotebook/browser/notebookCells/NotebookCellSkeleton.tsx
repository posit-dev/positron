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
			<NotebookCellActionBar onDelete={onDelete}>
				{actionBarItems}
			</NotebookCellActionBar>
			<div className='cell-contents'>
				{children}
			</div>
		</div>
	);
}

export function NotebookCellActionBar({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {

	return <div className='action-bar'>
		{children}
		<Button
			className='action-button'
			ariaLabel={localize('deleteCell', 'Delete cell')}
			onPressed={() => onDelete()}
		>
			<div className='button-icon codicon codicon-trash' />
		</Button>
	</div>;
}
