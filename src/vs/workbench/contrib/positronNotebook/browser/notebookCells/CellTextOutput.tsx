/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellTextOutput.css';

// React.
import React, { useSyncExternalStore } from 'react';

// Other dependencies.
import { ANSIOutput } from '../../../../../base/common/ansiOutput.js';
import { OutputLines } from '../../../../browser/positronAnsiRenderer/outputLines.js';
import { ParsedTextOutput } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { NotebookDisplayOptions } from '../../../notebook/browser/notebookOptions.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { NotebookCellQuickFix } from './NotebookCellQuickFix.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';

type LongOutputOptions = Pick<NotebookDisplayOptions, 'outputLineLimit' | 'outputScrolling'>;
type CellTextOutputOptions = LongOutputOptions & Pick<NotebookDisplayOptions, 'outputWordWrap'>;

type TruncationResult =
	{ content: string } & (
		{
			mode: 'normal' | 'scroll';
		} |
		{
			mode: 'truncate';
			contentAfter: string;
			numLinesTruncated: number;
		}
	);


function useLongOutputBehavior(content: string, options: LongOutputOptions) {
	const containerRef = React.useRef<HTMLDivElement | null>(null);
	const truncation = truncateToNumberOfLines(content, options);

	React.useEffect(() => {
		if (!containerRef.current) { return; }

		// Check if the content is scrolling
		const { scrollHeight, clientHeight } = containerRef.current;

		// If we're not scrolling, remove the class
		if (truncation.mode === 'scroll' && scrollHeight <= clientHeight) {
			containerRef.current.classList.remove(`long-output-scroll`);
		}
	}, [truncation.mode]);

	return { containerRef, truncation };
}

function useCellTextOutputOptions(): CellTextOutputOptions {
	const instance = useNotebookInstance();
	const config = useSyncExternalStore(
		(onStoreChange) => {
			const disposable = instance.notebookOptions.onDidChangeOptions((e) => {
				if (e.outputLineLimit || e.outputScrolling || e.outputWordWrap) {
					onStoreChange();
				}
			});
			return () => disposable.dispose();
		},
		() => instance.notebookOptions.getLayoutConfiguration()
	);
	return {
		outputLineLimit: config.outputLineLimit,
		outputScrolling: config.outputScrolling,
		outputWordWrap: config.outputWordWrap
	};
}

function truncateToNumberOfLines(content: string, { outputScrolling, outputLineLimit: maxLines }: LongOutputOptions): TruncationResult {
	// Trim newline from end of content if it exists.
	const splitByLine = content.trimEnd().split('\n');
	const numLines = splitByLine.length;

	const isLong = numLines > maxLines;

	if (!isLong) {
		return { content, mode: 'normal' };
	}

	if (outputScrolling) {
		return { content, mode: 'scroll' };
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
	const { outputLineLimit, outputScrolling, outputWordWrap } = useCellTextOutputOptions();
	const { containerRef, truncation } = useLongOutputBehavior(content, { outputLineLimit, outputScrolling });

	return <>
		<div ref={containerRef} className={positronClassNames(
			`notebook-${type}`,
			'positron-notebook-text-output',
			`long-output-${truncation.mode}`,
			{ 'word-wrap': outputWordWrap }
		)}>
			<OutputLines outputLines={ANSIOutput.processOutput(truncation.content)} />
			{
				truncation.mode === 'truncate'
					? <>
						<TruncationMessage commandService={services.commandService} truncationResult={truncation} />
						<OutputLines outputLines={ANSIOutput.processOutput(truncation.contentAfter)} />
					</>
					: null
			}
		</div>
		{
			truncation.mode === 'scroll'
				? <TruncationMessage commandService={services.commandService} truncationResult={truncation} />
				: null
		}
		{
			type === 'error'
				? <NotebookCellQuickFix errorContent={content} />
				: null
		}
	</>;
}

const TruncationMessage = ({ truncationResult, commandService }: { truncationResult: TruncationResult; commandService: ICommandService }) => {
	const openSettings = (e: React.MouseEvent) => {
		// Prevent the anchor's default navigation (href='') from reloading the page in the test environment.
		e.preventDefault();
		commandService.executeCommand(
			'workbench.action.openSettings',
			'notebook.output scroll'
		);
	};

	const msg = truncationResult.mode === 'truncate'
		? `... ${truncationResult.numLinesTruncated.toLocaleString()} lines truncated.`
		: 'Scrolling long outputs...';

	return <i className='notebook-output-truncation-message'>
		{msg + ' '}
		<a
			aria-label='notebook output settings'
			href=''
			onClick={openSettings}
		>Change behavior.</a>
	</i>;

};
