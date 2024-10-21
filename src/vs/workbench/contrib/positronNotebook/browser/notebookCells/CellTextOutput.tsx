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


function truncateToNumberOfLines(content: string, { mode, outputLineLimit: maxLines }: LongOutputBehavior): {
	truncatedContentBefore: string;
	truncatedContentAfter?: string;
	numLinesTruncated: number;
	willScroll: boolean;
} {
	const splitByLine = content.split('\n');
	const numLines = splitByLine.length;

	const isLong = numLines > maxLines;

	if (isLong && mode === 'scroll') { return { truncatedContentBefore: content, numLinesTruncated: 0, willScroll: true }; }

	return {
		truncatedContentBefore: splitByLine.slice(0, maxLines - 1).join('\n'),
		truncatedContentAfter: splitByLine[splitByLine.length - 1],
		numLinesTruncated: Math.max(numLines - maxLines, 0),
		willScroll: false
	};
}


export function CellTextOutput({ content, type }: ParsedTextOutput) {

	const { openerService, notificationService, commandService } = useServices();
	const longOutputBehavior = useLongOutputBehavior();

	const { truncatedContentBefore, truncatedContentAfter, numLinesTruncated, willScroll } = truncateToNumberOfLines(content, longOutputBehavior);

	return <div className={`notebook-${type} positron-notebook-text-output long-output-${longOutputBehavior.mode} ${willScroll ? 'scrolling' : ''}`}>
		<OutputLines
			outputLines={ANSIOutput.processOutput(truncatedContentBefore)}
			openerService={openerService}
			notificationService={notificationService}
		/>
		{
			numLinesTruncated ? <TruncationMessage numLinesTruncated={numLinesTruncated} commandService={commandService} /> : null
		}
		{
			truncatedContentAfter ? <OutputLines
				outputLines={ANSIOutput.processOutput(truncatedContentAfter)}
				openerService={openerService}
				notificationService={notificationService}
			/> : null
		}
	</div>;
}

const TruncationMessage = ({ numLinesTruncated, commandService }: { numLinesTruncated: number; commandService: ICommandService }) => {

	const linesTruncatedFormatted = numLinesTruncated.toLocaleString();
	const openSettings = () => {
		commandService.executeCommand(
			'workbench.action.openSettings',
			'notebook.output scroll'
		);
	};
	return <i
		className='notebook-output-truncation-message'
	>... ({linesTruncatedFormatted} lines truncated.{' '}
		<a
			href=''
			aria-label='notebook output settings'
			onClick={openSettings}
		>Change behavior.</a>
		)</i>;
};
