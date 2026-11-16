/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './tableDataCell.css';

// React.
import React, { useRef, useEffect } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { DataCell, DataCellKind } from '../../common/tableDataCache.js';
import { PositronDataExplorerColumn } from '../positronDataExplorerColumn.js';
import { PositronActionBarHoverManager } from '../../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { findMatchSpan, SearchTerm } from '../../common/dataExplorerSearch.js';

/**
 * TableDataCellProps interface.
 */
interface TableDataCellProps {
	column: PositronDataExplorerColumn;
	dataCell: DataCell;
	hoverManager?: PositronActionBarHoverManager;
	search?: SearchTerm;
	searchMatched?: boolean;
}

/**
 * Renders text with its leading and trailing whitespace made visible.
 * @param text The text.
 * @param match An optional [start, end) range of the text to highlight as a search match.
 */
export function renderLeadingTrailingWhitespace(text: string | undefined, match?: [number, number]) {
	text = text ?? '';

	if (text === '') {
		// TODO: is this what we want?
		return [<span className='whitespace'>{'<empty>'}</span>];
	}

	const EMPTY_SPACE_SYMBOL = '\u00B7';

	// Split the text into leading whitespace, content, and trailing whitespace. Text that is only
	// whitespace is all leading whitespace.
	const contentStart = text.length - text.trimStart().length;
	const contentEnd = contentStart === text.length ? text.length : text.trimEnd().length;
	const segments = [
		{ start: 0, end: contentStart, whitespace: true },
		{ start: contentStart, end: contentEnd, whitespace: false },
		{ start: contentEnd, end: text.length, whitespace: true },
	];

	// Render each segment, splitting it at the match boundaries.
	const [matchStart, matchEnd] = match ?? [text.length, text.length];
	const parts: (string | React.JSX.Element)[] = [];
	const render = (start: number, end: number, whitespace: boolean, highlight: boolean) => {
		if (start >= end) {
			return;
		}
		const content = whitespace ?
			<span key={parts.length} className='whitespace'>{EMPTY_SPACE_SYMBOL.repeat(end - start)}</span> :
			text.slice(start, end);
		parts.push(highlight ? <mark key={parts.length} className='search-match-text'>{content}</mark> : content);
	};
	for (const { start, end, whitespace } of segments) {
		render(start, Math.min(end, matchStart), whitespace, false);
		render(Math.max(start, matchStart), Math.min(end, matchEnd), whitespace, true);
		render(Math.max(start, matchEnd), end, whitespace, false);
	}

	return parts;
}

/**
 * TableDataCell component.
 * @param props A TableDataCellProps that contains the component properties.
 * @returns The rendered component.
 */
export const TableDataCell = (props: TableDataCellProps) => {
	// Render empty strings as special value
	// Initialize rendered output parts
	const formattedText = props.dataCell.formatted
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n');

	const match = props.searchMatched && props.search ? findMatchSpan(formattedText, props.search) : undefined;
	const parts = renderLeadingTrailingWhitespace(formattedText, match);

	let isSpecialValue = props.dataCell.kind !== DataCellKind.NON_NULL;

	let renderedOutput = parts;
	if (props.dataCell.kind === DataCellKind.NON_NULL && formattedText === '') {
		isSpecialValue = true;
		renderedOutput = [`<${localize('positron.dataExplorer.emptyString', "empty")}>`];
	}

	// Set the class names.
	const classNames = positronClassNames('text-value', { 'special-value': isSpecialValue });

	// Reference to the content element to check for truncation
	const contentRef = useRef<HTMLDivElement>(null);

	// Effect to handle hover tooltip for truncated text
	useEffect(() => {
		const contentElement = contentRef.current;
		if (!contentElement || !props.hoverManager) {
			return;
		}

		const checkTruncation = () => {
			// Check if text is truncated (offsetWidth < scrollWidth indicates truncation)
			const isTruncated = contentElement.offsetWidth < contentElement.scrollWidth;
			return isTruncated;
		};

		// Show tooltip when mouse enters if text is truncated
		const showTooltip = () => {
			if (props.dataCell.formatted && checkTruncation()) {
				// Only show tooltip for truncated cells with non-empty content
				props.hoverManager?.showHover(
					contentElement,
					props.dataCell.formatted
				);
			}
		};

		// Hide tooltip when mouse leaves
		const hideTooltip = () => {
			props.hoverManager?.hideHover();
		};

		// Add event listeners
		contentElement.addEventListener('mouseenter', showTooltip);
		contentElement.addEventListener('mouseleave', hideTooltip);

		// Return cleanup function
		return () => {
			contentElement.removeEventListener('mouseenter', showTooltip);
			contentElement.removeEventListener('mouseleave', hideTooltip);
			props.hoverManager?.hideHover();
		};
	}, [props.dataCell.formatted, props.hoverManager]);

	// Render.
	return (
		<div className={positronClassNames('text-container', props.column.alignment, { 'search-match': props.searchMatched })}>
			<div ref={contentRef} className={classNames}>
				{renderedOutput}
			</div>
		</div>
	);
};
