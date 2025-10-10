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
import { NotebookCodeCell } from './notebookCells/NotebookCodeCell.js';
import { NotebookMarkdownCell } from './notebookCells/NotebookMarkdownCell.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { FontMeasurements } from '../../../../editor/browser/config/fontMeasurements.js';
import { BareFontInfo } from '../../../../editor/common/config/fontInfo.js';
import { PixelRatio } from '../../../../base/browser/pixelRatio.js';
import { PositronNotebookCellGeneral } from './PositronNotebookCells/PositronNotebookCell.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { useScrollObserver } from './notebookCells/useScrollObserver.js';
import { ScreenReaderOnly } from '../../../../base/browser/ui/positronComponents/ScreenReaderOnly.js';
import { asCssVariable, asCssVariableName, checkboxBackground, editorBackground } from '../../../../platform/theme/common/colorRegistry.js';
import { editorGutter } from '../../../../editor/common/core/editorColorRegistry.js';


export function PositronNotebookComponent() {
	const notebookInstance = useNotebookInstance();
	const notebookCells = useObservedValue(notebookInstance.cells);
	const styles = useNotebookStyles();
	const containerRef = React.useRef<HTMLDivElement>(null);

	// Accessibility: Global announcements for notebook-level operations (cell add/delete).
	// These are rendered in a ScreenReaderOnly ARIA live region for screen reader users.
	const [globalAnnouncement, setGlobalAnnouncement] = React.useState<string>('');
	const previousCellCount = React.useRef<number>(notebookCells.length);

	React.useEffect(() => {
		notebookInstance.setCellsContainer(containerRef.current);
	}, [notebookInstance]);

	// Track cell count changes and announce to screen readers
	React.useEffect(() => {
		const currentCount = notebookCells.length;
		const previousCount = previousCellCount.current;

		if (currentCount > previousCount) {
			const added = currentCount - previousCount;
			setGlobalAnnouncement(`${added} cell${added > 1 ? 's' : ''} added. Total: ${currentCount}`);
		} else if (currentCount < previousCount) {
			const removed = previousCount - currentCount;
			setGlobalAnnouncement(`${removed} cell${removed > 1 ? 's' : ''} removed. Total: ${currentCount}`);
		}

		previousCellCount.current = currentCount;
	}, [notebookCells.length]);

	// Observe scroll events and fire to notebook instance
	useScrollObserver(containerRef, React.useCallback(() => {
		notebookInstance.fireScrollEvent();
	}, [notebookInstance]));

	return (
		<div className='positron-notebook' style={{ ...styles }}>
			<div ref={containerRef} className='positron-notebook-cells-container'>
				{notebookCells.length ? notebookCells.map((cell, index) => <>
					<NotebookCell key={cell.handleId} cell={cell as PositronNotebookCellGeneral} />
					<AddCellButtons index={index + 1} />
				</>) : <div>{localize('noCells', 'No cells')}</div>
				}
			</div>
			<ScreenReaderOnly className='notebook-announcements'>
				{globalAnnouncement}
			</ScreenReaderOnly>
		</div>
	);
}
/**
 * Get css properties for notebooks e.g. fonts and colors.
 * @returns A css properties object that sets css variables associated with notebooks.
 */
function useNotebookStyles(): React.CSSProperties {
	const services = usePositronReactServicesContext();

	const editorOptions = services.configurationService.getValue<IEditorOptions>('editor');
	const targetWindow = DOM.getActiveWindow();
	const fontInfo = FontMeasurements.readFontInfo(targetWindow, BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.getInstance(targetWindow).value));
	const family = fontInfo.fontFamily ?? `"SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace`;

	// eslint-disable-next-line local/code-no-dangerous-type-assertions
	return {
		/** Fonts */
		'--vscode-positronNotebook-text-output-font-family': family,
		'--vscode-positronNotebook-text-output-font-size': `${fontInfo.fontSize}px`,
		/** Selection bar */
		'--positron-notebook-selection-bar-width': '7px',
		/** Override the default editor background */
		[asCssVariableName(editorBackground)]: asCssVariable(checkboxBackground),
		[asCssVariableName(editorGutter)]: asCssVariable(checkboxBackground),
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
