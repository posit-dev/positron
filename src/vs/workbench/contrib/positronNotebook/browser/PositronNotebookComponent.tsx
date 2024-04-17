/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronNotebookComponent';

import * as React from 'react';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { AddCellButtons, AddCodeCellButton, AddMarkdownCellButton } from './AddCellButtons';
import { useObservedValue } from './useObservedValue';
import { localize } from 'vs/nls';
import { KernelStatusBadge } from './KernelStatusBadge';
import { NotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCell';
import { IconedButton } from 'vs/workbench/contrib/positronNotebook/browser/utilityComponents/IconedButton';


export function PositronNotebookComponent() {
	const notebookInstance = useNotebookInstance();
	const notebookCells = useObservedValue(notebookInstance.cells);

	return (
		<div className='positron-notebook'>
			<div className='positron-notebook-header'>
				<IconedButton
					codicon='run'
					label={localize('runAllCells', 'Run all cells')}
					onClick={() => { notebookInstance.runAllCells(); }}
				/>

				<div style={{ marginLeft: 'auto' }}></div>
				<AddCodeCellButton notebookInstance={notebookInstance} index={0} />
				<HeaderDivider />
				<AddMarkdownCellButton notebookInstance={notebookInstance} index={0} />
				<HeaderDivider />
				<KernelStatusBadge />
			</div>
			<div className='positron-notebook-cells-container'>
				{notebookCells?.length ? notebookCells?.map((cell, index) => <>
					<NotebookCell key={cell.viewModel.handle} cell={cell} />
					<AddCellButtons index={index + 1} />
				</>) : <div>{localize('noCells', 'No cells')}</div>
				}
			</div>
		</div>
	);
}

function HeaderDivider() {
	return <div className='positron-notebook-header-divider' />;
}

