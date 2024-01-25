/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronNotebookComponent';

import * as React from 'react';
import { ISize } from 'vs/base/browser/positronReactRenderer';
import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { InputObservable } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor';
import { observeValue } from '../common/utils/observeValue';
import { NotebookViewModelObservable } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookWidget';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';


export function PositronNotebookComponent(
	{ message, size, input, viewModel }:
		{
			message: string;
			size: ISettableObservable<ISize>;
			input: InputObservable;
			viewModel: NotebookViewModelObservable;
		}
) {
	console.log('Positron Notebook Component', { message, size });
	const [width, setWidth] = React.useState(size.get().width ?? 0);
	const [height, setHeight] = React.useState(size.get().height ?? 0);
	const [fileName, setFileName] = React.useState(input.get()?.resource.path || 'No file name');
	const [cells, setCells] = React.useState<readonly NotebookCellTextModel[]>([]);

	React.useEffect(() =>
		observeValue(size, {
			handleChange() {
				const { width, height } = size.get();
				setWidth(width);
				setHeight(height);

			}
		})
		, [size]);

	React.useEffect(() => observeValue(viewModel, {
		handleChange() {
			const cells = viewModel.get()?.notebookDocument.cells;
			if (cells) {
				setCells(cells);
			}
		}
	}), [viewModel]);

	React.useEffect(() =>
		observeValue(input, {
			handleChange() {
				const fileName = input.get()?.resource.path || 'No file name';
				setFileName(fileName);
			}
		}), [input]);

	return (
		<div className='positron-notebook'>
			<div className='positron-notebook-header'>
				<h2>Positron Notebooks: Operation Tracer Bullet</h2>
				<div>File: {fileName}</div>
				<div>Size: {width} x {height}</div>
			</div>


			<CellsDisplay cells={cells} />


		</div>
	);
}

function CellsDisplay({ cells }: { cells: readonly NotebookCellTextModel[] }) {
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
