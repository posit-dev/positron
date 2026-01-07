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
import { NotebookCodeCell } from './notebookCells/NotebookCodeCell.js';
import { NotebookMarkdownCell } from './notebookCells/NotebookMarkdownCell.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { FontMeasurements } from '../../../../editor/browser/config/fontMeasurements.js';
import { PixelRatio } from '../../../../base/browser/pixelRatio.js';
import { PositronNotebookCellGeneral } from './PositronNotebookCells/PositronNotebookCell.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { useScrollObserver } from './notebookCells/useScrollObserver.js';
import { ScreenReaderOnly } from '../../../../base/browser/ui/positronComponents/ScreenReaderOnly.js';
import { createBareFontInfoFromRawSettings } from '../../../../editor/common/config/fontInfoFromSettings.js';
import { useContextKeyValue } from './useContextKeyValue.js';
import { CONTEXT_FIND_WIDGET_VISIBLE } from '../../../../editor/contrib/find/browser/findModel.js';


export function PositronNotebookComponent() {
	const notebookInstance = useNotebookInstance();
	const notebookCells = useObservedValue(notebookInstance.cells);
	const fontStyles = useFontStyles();
	const containerRef = React.useRef<HTMLDivElement>(null);

	// Accessibility: Global announcements for notebook-level operations (cell add/delete).
	// These are rendered in a ScreenReaderOnly ARIA live region for screen reader users.
	const [globalAnnouncement, setGlobalAnnouncement] = React.useState<string>('');
	const previousCellCount = React.useRef<number>(notebookCells.length);

	// Track scroll position for scroll decoration
	const [isScrolled, setIsScrolled] = React.useState(false);

	// Track find widget visibility for scroll decoration
	const isFindWidgetVisible = useContextKeyValue(
		notebookInstance.scopedContextKeyService,
		CONTEXT_FIND_WIDGET_VISIBLE
	);

	React.useEffect(() => {
		notebookInstance.setCellsContainer(containerRef.current);
		// Initial scroll check
		if (containerRef.current) {
			setIsScrolled(containerRef.current.scrollTop > 0);
		}
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

	// Observe scroll events and fire to notebook instance, also track scroll position
	useScrollObserver(containerRef, React.useCallback(() => {
		notebookInstance.fireScrollEvent();
		setIsScrolled((containerRef.current?.scrollTop ?? 0) > 0);
	}, [notebookInstance]));

	// Determine if scroll decoration should be shown
	const showDecoration = isScrolled || isFindWidgetVisible;

	return (
		<div className='positron-notebook' style={{ ...fontStyles }}>
			{showDecoration && (
				<div
					aria-hidden='true'
					className='scroll-decoration'
					role='presentation'
				/>
			)}
			<div ref={containerRef} className='positron-notebook-cells-container'>
				<AddCellButtons index={0} />
				{notebookCells.map((cell, index) =>
					<React.Fragment key={cell.handle}>
						<NotebookCell cell={cell as PositronNotebookCellGeneral} />
						<AddCellButtons index={index + 1} />
					</React.Fragment>
				)}
			</div>
			<ScreenReaderOnly className='notebook-announcements'>
				{globalAnnouncement}
			</ScreenReaderOnly>
		</div>
	);
}
/**
 * Get css properties for fonts in the notebook.
 * @returns A css properties object that sets css variables associated with fonts in the notebook.
 */
function useFontStyles(): React.CSSProperties {
	const services = usePositronReactServicesContext();

	const editorOptions = services.configurationService.getValue<IEditorOptions>('editor');
	const targetWindow = DOM.getActiveWindow();
	const fontInfo = FontMeasurements.readFontInfo(targetWindow, createBareFontInfoFromRawSettings(editorOptions, PixelRatio.getInstance(targetWindow).value));
	const family = fontInfo.fontFamily ?? `"SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace`;

	return {
		['--vscode-positronNotebook-text-output-font-family' as string]: family,
		['--vscode-positronNotebook-text-output-font-size' as string]: `${fontInfo.fontSize}px`,
	};
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
