/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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

	useScrollContainerEvents(containerRef);

	return (
		<div className='positron-notebook' style={{ ...fontStyles }}>
			<PositronNotebookHeader notebookInstance={notebookInstance} />
			<div className='positron-notebook-cells-container' ref={containerRef}>
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

/**
 * Hook to manage scroll and DOM mutation events for the notebook cells container
 */
function useScrollContainerEvents(
	containerRef: React.RefObject<HTMLDivElement>,
) {
	const notebookInstance = useNotebookInstance();

	React.useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		// Fire initial scroll event after a small delay to ensure layout has settled
		const initialScrollTimeout = setTimeout(() => {
			notebookInstance.fireOnDidScrollCellsContainer();
		}, 50);

		// Set up scroll listener
		const scrollListener = DOM.addDisposableListener(container, 'scroll', () => {
			notebookInstance.fireOnDidScrollCellsContainer();
		});

		// Set up mutation observer to watch for DOM changes
		const observer = new MutationObserver(() => {
			// Small delay to let the DOM changes settle
			setTimeout(() => {
				notebookInstance.fireOnDidScrollCellsContainer();
			}, 0);
		});

		observer.observe(container, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['style', 'class']
		});

		return () => {
			clearTimeout(initialScrollTimeout);
			scrollListener.dispose();
			observer.disconnect();
		};
	}, [notebookInstance]);
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
