/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ISize } from 'vs/base/browser/positronReactRenderer';
import { ValueAndSubscriber } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor';
import { PositronNotebookEditorInput } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditorInput';

export function PositronNotebookComponent(
	{ message, size, input }:
		{
			message: string;
			size: ValueAndSubscriber<ISize>;
			input: PositronNotebookEditorInput;
		}
) {
	console.log('Positron Notebook Component', { message, size });
	const [width, setWidth] = React.useState(size.value?.width ?? 0);
	const [height, setHeight] = React.useState(size.value?.height ?? 0);
	const fileName = input.resource.path;

	React.useEffect(() => {
		const disposable = size.changeEvent((size) => {
			setWidth(size.width);
			setHeight(size.height);
		});
		return () => disposable.dispose();
	}, [size]);


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
