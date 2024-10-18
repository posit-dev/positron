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


function useLongOutputBehavior(): { mode: 'scroll' } | { mode: 'truncate'; outputLineLimit: number } {
	const notebookOptions = useNotebookOptions();
	const layoutOptions = notebookOptions.getLayoutConfiguration();

	const outputLineLimit = layoutOptions.outputLineLimit;
	const outputScrolling = layoutOptions.outputScrolling;

	if (outputScrolling) {
		return { mode: 'scroll' };
	}
	return { mode: 'truncate', outputLineLimit };
}

export function CellTextOutput({ content, type }: ParsedTextOutput) {

	const { openerService, notificationService } = useServices();
	const longOutputBehavior = useLongOutputBehavior();

	const { truncatedContent, wasTruncated } = truncateToNumberOfLines(content, longOutputBehavior.mode === 'truncate' ? longOutputBehavior.outputLineLimit : undefined);
	const processedAnsi = ANSIOutput.processOutput(truncatedContent);

	return <div className={`notebook-${type} positron-notebook-text-output long-output-${longOutputBehavior.mode}`}>
		<OutputLines
			outputLines={processedAnsi}
			openerService={openerService}
			notificationService={notificationService} />
		{
			wasTruncated ? <span>Long content truncated</span> : null
		}
	</div>;
}

function truncateToNumberOfLines(content: string, maxLines?: number): { truncatedContent: string; wasTruncated: boolean } {
	if (!maxLines) { return { truncatedContent: content, wasTruncated: false }; }
	const splitByLine = content.split('\n');
	const numLines = splitByLine.length;
	if (numLines <= maxLines) { return { truncatedContent: content, wasTruncated: false }; }

	return {
		truncatedContent: [
			...splitByLine.slice(0, maxLines - 1),
			'...',
			splitByLine[splitByLine.length - 1]
		].join('\n'),
		wasTruncated: true
	};
}
