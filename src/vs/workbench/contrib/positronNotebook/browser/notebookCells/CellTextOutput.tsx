/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellTextOutput.css';

// React.
import { useSyncExternalStore } from 'react';

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
import { useCellOutputsContainerOverflows } from './CellOutputsOverflowContext.js';

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
	const overflows = useCellOutputsContainerOverflows();
	const truncation = truncateToNumberOfLines(content, { outputLineLimit, outputScrolling });

	// When in scroll mode but content doesn't actually overflow the
	// max-height container, downgrade to 'normal' so the scroll chrome
	// (max-height, scrollbars, truncation message) is hidden.
	// `overflows === null` means not yet measured -- keep scroll mode.
	const effectiveMode = truncation.mode === 'scroll' && overflows === false
		? 'normal' : truncation.mode;

	return <>
		<div className={positronClassNames(
			`notebook-${type}`,
			'positron-notebook-text-output',
			`long-output-${effectiveMode}`,
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
			effectiveMode === 'scroll'
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
	const openSettings = () => {
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
		<button
			aria-label='notebook output settings'
			className='notebook-output-settings-link'
			type='button'
			onClick={openSettings}
		>Change behavior.</button>
	</i>;
};
