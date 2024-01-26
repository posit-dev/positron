/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronNotebookComponent';

import * as React from 'react';
import { ISize } from 'vs/base/browser/positronReactRenderer';
import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { InputObservable } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor';
import { NotebookKernelObservable, NotebookViewModelObservable } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookWidget';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { useObservedValue } from './useObservedValue';


export function PositronNotebookComponent(
	{ message, sizeObservable, inputObservable, viewModelObservable, kernelObservable }:
		{
			message: string;
			sizeObservable: ISettableObservable<ISize>;
			inputObservable: InputObservable;
			viewModelObservable: NotebookViewModelObservable;
			kernelObservable: NotebookKernelObservable;
		}
) {
	console.log('Positron Notebook Component', { message, size: sizeObservable });

	const size = useObservedValue(sizeObservable);
	const fileName = useObservedValue(inputObservable, input => input?.resource.path || 'No file name');
	const kernelId = useObservedValue(kernelObservable, kernel => kernel?.id || null);

	return (
		<div className='positron-notebook'>
			<div className='positron-notebook-header'>
				<h2>Positron Notebooks: Operation Tracer Bullet</h2>
				<div>File: {fileName}</div>
				<div>{kernelId ? `Kernel: ${kernelId}` : `No Kernel Loaded`}</div>
				<div>Size: {size?.width} x {size?.height}</div>
			</div>
			<CellsDisplay viewModelObservable={viewModelObservable} />
		</div>
	);
}

function CellsDisplay({ viewModelObservable }: { viewModelObservable: NotebookViewModelObservable }) {
	const cells = useObservedValue(viewModelObservable, viewModel => viewModel?.notebookDocument.cells || []);

	if (cells.length === 0) {
		return <div>No cells</div>;
	}

	return (
		<div className='positron-notebook-cells-container'>
			<h2>Notebook Cells</h2>
			{cells.map(cell => <CellDisplay key={cell.handle} cell={cell}></CellDisplay>)}
		</div>
	);
}

function CellDisplay({ cell }: { cell: NotebookCellTextModel }) {
	const label = 'Run cell';
	return (
		<div className='positron-notebook-cell'>
			<PositronButton className='run-button' ariaLabel={label} onClick={
				() => {
					console.log('Run this cell please', cell.getValue());
				}
			}>
				<div className={`button-icon codicon codicon-run`} />
			</PositronButton>
			<pre>{cell.getValue()}</pre>
		</div>
	);
}





