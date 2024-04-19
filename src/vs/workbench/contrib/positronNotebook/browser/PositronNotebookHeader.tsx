/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./PositronNotebookHeader';

import * as React from 'react';
import { AddCodeCellButton, AddMarkdownCellButton } from './AddCellButtons';
import { localize } from 'vs/nls';
import { KernelStatusBadge } from './KernelStatusBadge';
import { IconedButton } from 'vs/workbench/contrib/positronNotebook/browser/utilityComponents/IconedButton';
import { PositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';

export function PositronNotebookHeader({ notebookInstance }: { notebookInstance: PositronNotebookInstance }) {
	return <div className='positron-notebook-header'>
		<IconedButton
			codicon='run'
			label={(() => localize('runAllCells', 'Run All Cells'))()}
			onClick={() => { notebookInstance.runAllCells(); }} />
		<div style={{ marginLeft: 'auto' }}></div>
		<AddCodeCellButton notebookInstance={notebookInstance} index={0} />
		<HeaderDivider />
		<AddMarkdownCellButton notebookInstance={notebookInstance} index={0} />
		<HeaderDivider />
		<KernelStatusBadge />
	</div>;
}

function HeaderDivider() {
	return <div className='positron-notebook-header-divider' />;
}

