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
import { useServices } from '../ServicesProvider.js';
import { ParsedTextOutput } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { useNotebookOptions } from '../NotebookInstanceProvider.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { NotebookDisplayOptions } from '../../../notebook/browser/notebookOptions.js';

type LongOutputOptions = Pick<NotebookDisplayOptions, 'outputLineLimit' | 'outputScrolling'>;

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


function useLongOutputBehavior(content: string): {
	containerRef: React.RefObject<HTMLDivElement>; truncation: TruncationResult;
} {
	const containerRef = React.useRef<HTMLDivElement>(null!);
	const notebookOptions = useNotebookOptions();
	const layoutOptions = notebookOptions.getLayoutConfiguration();

	const [truncation, setTruncation] = React.useState<TruncationResult>(() => truncateToNumberOfLines(content, layoutOptions));

	React.useEffect(() => {
		setTruncation(truncateToNumberOfLines(content, layoutOptions));
	}, [content, layoutOptions]);

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

	const { openerService, notificationService, commandService } = useServices();
	const { containerRef, truncation } = useLongOutputBehavior(content);

	return <>
		<div ref={containerRef} className={`notebook-${type} positron-notebook-text-output long-output-${truncation.mode}`}>
			<OutputLines
				notificationService={notificationService}
				openerService={openerService}
				outputLines={ANSIOutput.processOutput(truncation.content)}
			/>
			{
				truncation.mode === 'truncate'
					? <>
						<TruncationMessage commandService={commandService} truncationResult={truncation} />
						<OutputLines
							notificationService={notificationService}
							openerService={openerService}
							outputLines={ANSIOutput.processOutput(truncation.contentAfter)}
						/>
					</>
					: null
			}
		</div>
		{
			truncation.mode === 'scroll'
				? <TruncationMessage commandService={commandService} truncationResult={truncation} />
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
		<a
			aria-label='notebook output settings'
			href=''
			onClick={openSettings}
		>Change behavior.</a>
	</i>;

};

