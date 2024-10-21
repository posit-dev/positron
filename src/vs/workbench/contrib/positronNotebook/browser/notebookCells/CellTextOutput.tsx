/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./CellTextOutput';

import * as React from 'react';
import { ANSIOutput } from 'vs/base/common/ansiOutput';
import { OutputLines } from 'vs/workbench/browser/positronAnsiRenderer/outputLines';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { ParsedTextOutput } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { useNotebookOptions } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { ICommandService } from 'vs/platform/commands/common/commands';


type LongOutputBehavior = { mode: 'truncate' | 'scroll'; outputLineLimit: number };
function useLongOutputBehavior(): LongOutputBehavior {
	const notebookOptions = useNotebookOptions();
	const layoutOptions = notebookOptions.getLayoutConfiguration();

	const outputLineLimit = layoutOptions.outputLineLimit;
	const outputScrolling = layoutOptions.outputScrolling;

	return { mode: outputScrolling ? 'scroll' : 'truncate', outputLineLimit };
}


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

function truncateToNumberOfLines(content: string, { mode, outputLineLimit: maxLines }: LongOutputBehavior): TruncationResult {
	const splitByLine = content.split('\n');
	const numLines = splitByLine.length;

	const isLong = numLines > maxLines;

	if (!isLong) {
		return { content, mode: 'normal' };
	}

	if (mode === 'scroll') {
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
	const longOutputBehavior = useLongOutputBehavior();
	const truncation = truncateToNumberOfLines(content, longOutputBehavior);

	return <>
		<div className={`notebook-${type} positron-notebook-text-output long-output-${truncation.mode}`}>
			<OutputLines
				outputLines={ANSIOutput.processOutput(truncation.content)}
				openerService={openerService}
				notificationService={notificationService}
			/>

			{
				truncation.mode === 'truncate'
					? <>
						<TruncationMessage truncationResult={truncation} commandService={commandService} />
						<OutputLines
							outputLines={ANSIOutput.processOutput(truncation.contentAfter)}
							openerService={openerService}
							notificationService={notificationService}
						/>
					</>
					: null
			}
		</div>
		{
			truncation.mode === 'scroll'
				? <TruncationMessage truncationResult={truncation} commandService={commandService} />
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

	return <i
		className={`notebook-output-truncation-message truncation-mode-${truncationResult.mode}`}
	>
		{msg + ' '}
		<a
			href=''
			aria-label='notebook output settings'
			onClick={openSettings}
		>Change behavior.</a>
	</i>;

};

