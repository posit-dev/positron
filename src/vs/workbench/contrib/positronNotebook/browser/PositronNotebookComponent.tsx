/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ISize } from 'vs/base/browser/positronReactRenderer';
import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { InputObservable } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor';
import { observeValue } from '../common/utils/observeValue';


export function PositronNotebookComponent(
	{ message, size, input }:
		{
			message: string;
			size: ISettableObservable<ISize>;
			input: InputObservable;
		}
) {
	console.log('Positron Notebook Component', { message, size });
	const [width, setWidth] = React.useState(size.get().width ?? 0);
	const [height, setHeight] = React.useState(size.get().height ?? 0);
	const [fileName, setFileName] = React.useState(input.get()?.resource.path || 'No file name');

	React.useEffect(() =>
		observeValue(size, {
			handleChange() {
				const { width, height } = size.get();
				setWidth(width);
				setHeight(height);

			}
		})
		, [size]);

	React.useEffect(() =>
		observeValue(input, {
			handleChange() {
				const fileName = input.get()?.resource.path || 'No file name';
				setFileName(fileName);
			}
		}), [input]);

	return (
		<div>
			<h2>Hi there!</h2>
			<div>File: {fileName}</div>
			<div>{message}</div>
			<div>
				Size: {width} x {height}
			</div>
		</div>
	);
}
