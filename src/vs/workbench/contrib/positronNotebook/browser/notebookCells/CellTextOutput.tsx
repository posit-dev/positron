/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellTextOutput.css';

// React.
import React from 'react';

// Other dependencies.
import { ANSIOutput } from '../../../../../base/common/ansiOutput.js';
import { OutputLines } from '../../../../browser/positronAnsiRenderer/outputLines.js';
import { ParsedTextOutput } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { useNotebookOptions } from '../NotebookInstanceProvider.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { NotebookCellQuickFix } from './NotebookCellQuickFix.js';

type TruncationResult =
	{ content: string } & (
		{ mode: 'normal' } |
		{
			mode: 'truncate';
			contentAfter: string;
			numLinesTruncated: number;
		}
	);

function truncateToNumberOfLines(content: string, outputScrolling: boolean, maxLines: number): TruncationResult {
	// Trim newline from end of content if it exists.
	const splitByLine = content.trimEnd().split('\n');
	const numLines = splitByLine.length;

	// When scrolling is enabled or content is short, return as-is.
	// The parent container handles scroll constraints via CSS.
	if (outputScrolling || numLines <= maxLines) {
		return { content, mode: 'normal' };
	}

	return {
		mode: 'truncate',
		content: splitByLine.slice(0, maxLines - 1).join('\n'),
		contentAfter: splitByLine[splitByLine.length - 1],
		numLinesTruncated: Math.max(numLines - maxLines, 0),
	};
}

export interface CellTextOutputProps extends ParsedTextOutput {
	outputScrolling: boolean;
	onShowFullOutput: () => void;
}


export function CellTextOutput({
	content,
	type,
	outputScrolling,
	onShowFullOutput,
}: CellTextOutputProps) {

	const layoutConfig = useNotebookOptions().getLayoutConfiguration();
	const truncation = truncateToNumberOfLines(content, outputScrolling, layoutConfig.outputLineLimit);
	const outputWordWrap = layoutConfig.outputWordWrap;

	return <>
		<div className={positronClassNames(
			`notebook-${type}`,
			'positron-notebook-text-output',
			{ 'word-wrap': outputWordWrap },
		)}>
			<OutputLines outputLines={ANSIOutput.processOutput(truncation.content)} />
			{truncation.mode === 'truncate' && <>
				<TruncationMessage
					numLinesTruncated={truncation.numLinesTruncated}
					onShowFullOutput={onShowFullOutput}
				/>
				<OutputLines outputLines={ANSIOutput.processOutput(truncation.contentAfter)} />
			</>}
		</div>
		{type === 'error' && <NotebookCellQuickFix errorContent={content} />}
	</>;
}

const TruncationMessage = ({ numLinesTruncated, onShowFullOutput }: {
	numLinesTruncated: number;
	onShowFullOutput: () => void;
}) => {
	const openSettings = (e: React.MouseEvent<HTMLAnchorElement>) => {
		// Prevent the anchor from navigating, which would reload the
		// Electron renderer and hang the window.
		e.preventDefault();
		onShowFullOutput();
	};

	return <i className='notebook-output-truncation-message'>
		{`... ${numLinesTruncated.toLocaleString()} lines truncated. `}
		<a
			aria-label='notebook output settings'
			href=''
			onClick={openSettings}
		>Change behavior.</a>
	</i>;
};
