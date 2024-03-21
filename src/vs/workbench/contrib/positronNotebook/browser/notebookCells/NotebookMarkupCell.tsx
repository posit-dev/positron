/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IPositronNotebookMarkupCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';

import { marked } from 'marked';


export function NotebookMarkupCell({ cell }: { cell: IPositronNotebookMarkupCell }) {
	const htmlOfContent = marked(cell.getContent()) as string;

	return <div>
		{htmlOfContent}
	</div>;
}
