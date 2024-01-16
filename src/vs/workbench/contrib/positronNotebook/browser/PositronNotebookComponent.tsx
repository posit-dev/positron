/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ISize } from 'vs/base/browser/positronReactRenderer';
import { URI } from 'vs/base/common/uri';
import { ValueAndSubscriber } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor';

export function PositronNotebookComponent(
	{ message, size, file }:
		{
			message: string;
			size: ValueAndSubscriber<ISize>;
			file: ValueAndSubscriber<URI>;
		}
) {
	console.log('Positron Notebook Component', { message, size, file });
	const [width, setWidth] = React.useState(size.value?.width ?? 0);
	const [height, setHeight] = React.useState(size.value?.height ?? 0);
	const [fileName, setFileName] = React.useState(file.value?.path ?? 'No file received yet');

	React.useEffect(() => {
		const disposable = size.changeEvent((size) => {
			setWidth(size.width);
			setHeight(size.height);
		});
		return () => disposable.dispose();
	}, [size]);


	React.useEffect(() => {
		const disposable = file.changeEvent((uri) => {
			console.log('New file received: ' + uri.path);
			setFileName(uri.path);
		});
		return () => disposable.dispose();
	}, [file]);

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
