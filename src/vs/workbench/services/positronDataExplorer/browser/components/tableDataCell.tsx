/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './tableDataCell.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { DataCell, DataCellKind } from '../../common/tableDataCache.js';
import { PositronDataExplorerColumn } from '../positronDataExplorerColumn.js';

/**
 * TableDataCellProps interface.
 */
interface TableDataCellProps {
	column: PositronDataExplorerColumn;
	dataCell: DataCell;
}

export function renderLeadingTrailingWhitespace(text: string | undefined) {
	const parts: (string | JSX.Element)[] = [];

	text = text ?? '';

	if (text === '') {
		// TODO: is this what we want?
		return [<span className='whitespace'>{'<empty>'}</span>];
	}

	const EMPTY_SPACE_SYMBOL = '\u00B7';

	// Handle text that is only whitespace
	if (text.trim() === '') {
		parts.push(
			<span className='whitespace'>
				{EMPTY_SPACE_SYMBOL.repeat(text.length)}
			</span>
		);
	} else {
		// Handle leading whitespace
		const leadingMatch = text.match(/^\s+/);
		if (leadingMatch) {
			parts.push(
				<span className='whitespace'>
					{EMPTY_SPACE_SYMBOL.repeat(leadingMatch[0].length)}
				</span>
			);
		}

		// Add the main content
		const mainContent = text.trim();
		parts.push(mainContent);

		// Handle trailing whitespace
		const trailingMatch = text.match(/\s+$/);
		if (trailingMatch) {
			parts.push(
				<span className='whitespace'>
					{EMPTY_SPACE_SYMBOL.repeat(trailingMatch[0].length)}
				</span>
			);
		}
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

	const parts = renderLeadingTrailingWhitespace(formattedText);

	let isSpecialValue = props.dataCell.kind !== DataCellKind.NON_NULL;

	let renderedOutput = parts;
	if (props.dataCell.kind === DataCellKind.NON_NULL && formattedText === '') {
		isSpecialValue = true;
		renderedOutput = [`<${localize('positron.dataExplorer.emptyString', "empty")}>`];
	}

	// Set the class names.
	const classNames = positronClassNames('text-value', { 'special-value': isSpecialValue });

	// Render.
	return (
		<div className={positronClassNames('text-container', props.column.alignment)}>
			<div className={classNames}>
				{renderedOutput}
			</div>
		</div>
	);
};
