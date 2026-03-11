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
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { NotebookDisplayOptions } from '../../../notebook/browser/notebookOptions.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { NotebookCellQuickFix } from './NotebookCellQuickFix.js';

export type LongOutputOptions = Pick<NotebookDisplayOptions, 'outputLineLimit' | 'outputScrolling'>;

type TruncationResult =
	{ content: string } & (
		{ mode: 'normal' } |
		{
			mode: 'truncate';
			contentAfter: string;
			numLinesTruncated: number;
		}
	);


function useLongOutputBehavior(content: string): TruncationResult {
	const notebookOptions = useNotebookOptions();
	const layoutOptions = notebookOptions.getLayoutConfiguration();
	return truncateToNumberOfLines(content, layoutOptions);
}


function truncateToNumberOfLines(content: string, { outputScrolling, outputLineLimit: maxLines }: LongOutputOptions): TruncationResult {
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


export function CellTextOutput({ content, type }: ParsedTextOutput) {

	const services = usePositronReactServicesContext();
	const truncation = useLongOutputBehavior(content);
	const notebookOptions = useNotebookOptions();
	const outputWordWrap = notebookOptions.getLayoutConfiguration().outputWordWrap;

	return <>
		<div className={`notebook-${type} positron-notebook-text-output${outputWordWrap ? ' word-wrap' : ''}`}>
			<OutputLines outputLines={ANSIOutput.processOutput(truncation.content)} />
			{truncation.mode === 'truncate' && <>
				<TruncationMessage
					commandService={services.commandService}
					numLinesTruncated={truncation.numLinesTruncated}
				/>
				<OutputLines outputLines={ANSIOutput.processOutput(truncation.contentAfter)} />
			</>}
		</div>
		{type === 'error' && <NotebookCellQuickFix errorContent={content} />}
	</>;
}

const TruncationMessage = ({ numLinesTruncated, commandService }: {
	numLinesTruncated: number;
	commandService: ICommandService;
}) => {
	const openSettings = (e: React.MouseEvent<HTMLAnchorElement>) => {
		// Prevent the anchor from navigating, which would reload the
		// Electron renderer and hang the window.
		e.preventDefault();
		commandService.executeCommand(
			'workbench.action.openSettings',
			'notebook.output scroll'
		);
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
