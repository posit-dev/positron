/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './PositronNotebookComponent.css';

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { useNotebookInstance } from './NotebookInstanceProvider.js';
import { AddCellButtons } from './AddCellButtons.js';
import { useObservedValue } from './useObservedValue.js';
import { localize } from '../../../../nls.js';
import { PositronNotebookHeader } from './PositronNotebookHeader.js';
import { NotebookCodeCell } from './notebookCells/NotebookCodeCell.js';
import { NotebookMarkdownCell } from './notebookCells/NotebookMarkdownCell.js';
import { useServices } from './ServicesProvider.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { FontMeasurements } from '../../../../editor/browser/config/fontMeasurements.js';
import { BareFontInfo } from '../../../../editor/common/config/fontInfo.js';
import { PixelRatio } from '../../../../base/browser/pixelRatio.js';
import { PositronNotebookCellGeneral } from './PositronNotebookCells/PositronNotebookCell.js';


export function PositronNotebookComponent() {
	const notebookInstance = useNotebookInstance();
	const notebookCells = useObservedValue(notebookInstance.cells);
	const fontStyles = useFontStyles();
	const containerRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		notebookInstance.setCellsContainer(containerRef.current);
	}, [notebookInstance]);

	return (
		<div className='positron-notebook' style={{ ...fontStyles }}>
			<PositronNotebookHeader notebookInstance={notebookInstance} />
			<div ref={containerRef} className='positron-notebook-cells-container'>
				{notebookCells?.length ? notebookCells?.map((cell, index) => <>
					<NotebookCell key={cell.handleId} cell={cell as PositronNotebookCellGeneral} />
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
	cell: PositronNotebookCellGeneral;
}) {

	if (cell.isCodeCell()) {
		return <NotebookCodeCell cell={cell} />;
	}

	if (cell.isMarkdownCell()) {
		return <NotebookMarkdownCell cell={cell} />;
	}

	throw new Error('Unknown cell type');
}
