/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCodeCell';

import * as React from 'react';
import { VSBuffer } from 'vs/base/common/buffer';
import { NotebookCellOutputTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellOutputTextModel';
import { NotebookCellOutputs } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { isParsedTextOutput, parseOutputData } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget';
import { localize } from 'vs/nls';
import { NotebookCellActionBar } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellActionBar';
import { CellTextOutput } from './CellTextOutput';
import { ActionButton } from 'vs/workbench/contrib/positronNotebook/browser/utilityComponents/ActionButton';
import { NotebookCellWrapper } from './NotebookCellWrapper';
import { PositronNotebookCodeCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { WebviewContentPurpose } from 'vs/workbench/contrib/webview/browser/webview';
import { transformWebviewThemeVars } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewThemeMapping';
import { getWindow } from 'vs/base/browser/dom';


export function NotebookCodeCell({ cell }: { cell: PositronNotebookCodeCell }) {
	const outputContents = useObservedValue(cell.outputs);
	const executionStatus = useObservedValue(cell.executionStatus);
	const isRunning = executionStatus === 'running';

	return <NotebookCellWrapper cell={cell}>
		<NotebookCellActionBar cell={cell}>
			<ActionButton
				ariaLabel={isRunning ? localize('stopExecution', 'Stop execution') : localize('runCell', 'Run cell')}
				onPressed={() => cell.run()} >
				<div className={`button-icon codicon ${isRunning ? 'codicon-primitive-square' : 'codicon-run'}`} />
			</ActionButton>
		</NotebookCellActionBar>
		<div className='cell-contents'>
			<CellEditorMonacoWidget cell={cell} />
			<div className='positron-notebook-cell-outputs'>
				{outputContents?.map((output) => <NotebookCellOutput key={output.outputId} cellOutput={output} />)}
			</div>
		</div>
	</NotebookCellWrapper>;

}

function NotebookCellOutput({ cellOutput }: { cellOutput: NotebookCellOutputs }) {

	const { outputs } = cellOutput;


	if (cellOutput instanceof NotebookCellOutputTextModel) {

		return <>
			{outputs.map(({ data, mime }, i) => <CellOutputContents key={i} data={data} mime={mime} />)}
		</>;
	}

	return <div>
		{localize('cellExecutionUnknownOutputType', 'Can not handle output type: OutputId: {0}', cellOutput.outputId)}
	</div>;
}

function CellOutputContents(output: { data: VSBuffer; mime: string }) {

	const parsed = parseOutputData(output);

	if (isParsedTextOutput(parsed)) {
		return <CellTextOutput {...parsed} />;
	}

	switch (parsed.type) {
		case 'interupt':
			return <div className='notebook-error'>
				{localize('cellExecutionKeyboardInterupt', 'Cell execution stopped due to keyboard interupt.')}
			</div>;
		case 'image':
			return <img src={parsed.dataUrl} alt='output image' />;
		case 'html':
			return <HTMLContent content={parsed.content} />;
		case 'unknown':
			return <div className='unknown-mime-type'>
				{localize('cellExecutionUnknownMimeType', 'Cant handle mime type "{0}" yet', output.mime)}
			</div>;
	}
}


// Styles that get added to the HTML content of the webview for things like cleaning
// up tables etc..
const htmlOutputStyles = `
<style>
	table {
		width: 100%;
		border-collapse: collapse;
	}
	table, th, td {
		border: 1px solid #ddd;
	}
	th, td {
		padding: 8px;
		text-align: left;
	}
	tr:nth-child(even) {
		background-color: var(--vscode-textBlockQuote-background, #f2f2f2);
	}
</style>
`;

function HTMLContent({ content }: { content: string }) {
	const { webviewService } = useServices();

	const containerRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const webviewElement = webviewService.createWebviewElement({
			title: localize('positron.notebook.webview', "Positron Notebook HTML content"),
			options: {
				purpose: WebviewContentPurpose.NotebookRenderer,
				enableFindWidget: false,
				transformCssVariables: transformWebviewThemeVars,
			},
			contentOptions: {
				allowMultipleAPIAcquire: true,
				allowScripts: true,
			},
			extension: undefined,
			providedViewType: 'notebook.output'
		});

		const contentWithStyles = htmlOutputStyles + content;
		webviewElement.setHtml(contentWithStyles);
		webviewElement.mountTo(containerRef.current, getWindow(containerRef.current));
		return () => webviewElement.dispose();
	}, [content, webviewService]);

	return <div className='positron-notebook-html-output' ref={containerRef}></div>;
}


