/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellTextOutput.css';

// Other dependencies.
import { ANSIOutput } from '../../../../../base/common/ansiOutput.js';
import { OutputLines } from '../../../../browser/positronAnsiRenderer/outputLines.js';
import { ParsedTextOutput } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { useNotebookInstance, useNotebookOptions } from '../NotebookInstanceProvider.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { localize } from '../../../../../nls.js';
import { NotebookCellQuickFix } from './NotebookCellQuickFix.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

const showMoreLinesLabel = (n: number) => localize(
	'positron.notebook.showMoreLines',
	"... Show {0} more lines",
	n.toLocaleString()
);
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

	// Split point: 50/50 between top and bottom
	const topLines = Math.ceil(maxLines / 2);
	const bottomLines = maxLines - topLines;

	return {
		mode: 'truncate',
		content: splitByLine.slice(0, topLines).join('\n'),
		contentAfter: splitByLine.slice(numLines - bottomLines).join('\n'),
		numLinesTruncated: numLines - maxLines,
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
	const instance = useNotebookInstance();
	const label = showMoreLinesLabel(numLinesTruncated);
	return <Button
		ariaLabel={label}
		className='notebook-output-truncation-message'
		hoverManager={instance.hoverManager}
		onPressed={onShowFullOutput}
	>
		{label}
	</Button>;
};

