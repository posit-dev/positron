/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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
			codicon='notebook-execute-all'
			label={(() => localize('runAllCellsShort', 'Run All'))()}
			fullLabel={(() => localize('runAllCellsLong', 'Run All Cells'))()}
			onClick={() => { notebookInstance.runAllCells(); }} />
		<div style={{ marginLeft: 'auto' }}></div>
		<AddCodeCellButton notebookInstance={notebookInstance} index={0} />
		<AddMarkdownCellButton notebookInstance={notebookInstance} index={0} />
		<HeaderDivider />
		<KernelStatusBadge />
	</div>;
}

function HeaderDivider() {
	return <div className='positron-notebook-header-divider' />;
}

