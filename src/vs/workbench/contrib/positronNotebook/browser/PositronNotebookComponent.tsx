/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronNotebookComponent';

import * as DOM from 'vs/base/browser/dom';
import * as React from 'react';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { AddCellButtons } from './AddCellButtons';
import { useObservedValue } from './useObservedValue';
import { localize } from 'vs/nls';
import { PositronNotebookHeader } from './PositronNotebookHeader';
import { IPositronNotebookCell } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { NotebookCodeCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCodeCell';
import { NotebookMarkdownCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookMarkdownCell';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { FontMeasurements } from 'vs/editor/browser/config/fontMeasurements';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { PixelRatio } from 'vs/base/browser/pixelRatio';


export function PositronNotebookComponent() {
	const notebookInstance = useNotebookInstance();
	const notebookCells = useObservedValue(notebookInstance.cells);
	const fontStyles = useFontStyles();

	return (
		<div className='positron-notebook' style={{ ...fontStyles }}>
			<PositronNotebookHeader notebookInstance={notebookInstance} />
			<div className='positron-notebook-cells-container'>
				{notebookCells?.length ? notebookCells?.map((cell, index) => <>
					<NotebookCell key={cell.handle} cell={cell} />
					<AddCellButtons index={index + 1} />
				</>) : <div>{localize('noCells', 'No cells')}</div>
				}
			</div>
		</div>
	);
}
/**
 * Get css properties for fonts in the notebook.
 * @returns A css properties object that sets css variables associated with fonts in the notebook.
 */
function useFontStyles(): React.CSSProperties {
	const { configurationService } = useServices();

	const editorOptions = configurationService.getValue<IEditorOptions>('editor');
	const targetWindow = DOM.getActiveWindow();
	const fontInfo = FontMeasurements.readFontInfo(targetWindow, BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.getInstance(targetWindow).value));
	const family = fontInfo.fontFamily ?? `"SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace`;

	return {
		'--vscode-positronNotebook-text-output-font-family': family,
		'--vscode-positronNotebook-text-output-font-size': `${fontInfo.fontSize}px`,
	} as React.CSSProperties;
}

function NotebookCell({ cell }: {
	cell: IPositronNotebookCell;
}) {

	if (cell.isCodeCell()) {
		return <NotebookCodeCell cell={cell} />;
	}

	if (cell.isMarkdownCell()) {
		return <NotebookMarkdownCell cell={cell} />;
	}

	throw new Error('Unknown cell type');
}
