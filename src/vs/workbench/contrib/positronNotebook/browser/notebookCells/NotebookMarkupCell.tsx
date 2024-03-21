/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookMarkupCell';

import * as React from 'react';
import { IPositronNotebookMarkupCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';

import { marked } from 'marked';
import { renderHtml } from 'vs/base/browser/renderHtml';
import { CellEditorMonacoWidget } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/CellEditorMonacoWidget';



export function NotebookMarkupCell({ cell }: { cell: IPositronNotebookMarkupCell }) {
	return <div>
		<CellEditorMonacoWidget cell={cell} />
		<div className='positron-notebook-markup-rendered'>
			<RenderMarkdown content={cell.getContent()} />
		</div>
	</div>;
}

function RenderMarkdown({ content }: { content: string }) {
	const htmlOfContent = marked(content) as string;
	return <div>{renderHtml(htmlOfContent)}</div>;
}
