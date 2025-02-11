/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './PositronNotebookHeader.css';

// React.
import React from 'react';

// Other dependencies.
import { AddCodeCellButton, AddMarkdownCellButton } from './AddCellButtons.js';
import { localize } from '../../../../nls.js';
import { KernelStatusBadge } from './KernelStatusBadge.js';
import { IconedButton } from './utilityComponents/IconedButton.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';

export function PositronNotebookHeader({ notebookInstance }: { notebookInstance: PositronNotebookInstance }) {
	return <div className='positron-notebook-header'>
		<IconedButton
			codicon='notebook-execute-all'
			fullLabel={(() => localize('runAllCellsLong', 'Run All Cells'))()}
			label={(() => localize('runAllCellsShort', 'Run All'))()}
			onClick={() => { notebookInstance.runAllCells(); }} />
		<IconedButton
			codicon='positron-clean'
			fullLabel={(() => localize('clearAllCellOutputsLong', 'Clear All Cell Outputs'))()}
			label={(() => localize('clearAllCellOutputsShort', 'Clear Outputs'))()}
			onClick={() => { notebookInstance.clearAllCellOutputs(); }} />
		<div style={{ marginLeft: 'auto' }}></div>
		<AddCodeCellButton index={0} notebookInstance={notebookInstance} />
		<AddMarkdownCellButton index={0} notebookInstance={notebookInstance} />
		<HeaderDivider />
		<KernelStatusBadge />
	</div>;
}

function HeaderDivider() {
	return <div className='positron-notebook-header-divider' />;
}

