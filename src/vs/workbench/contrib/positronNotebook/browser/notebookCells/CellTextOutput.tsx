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
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ThemeIcon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../../base/common/codicons.js';

type TruncationMessageStyle = 'chevron' | 'ellipsis';
const TRUNCATION_MESSAGE_STYLE_SETTING = 'notebook.output.truncationMessageStyle';

const showMoreLinesChevronLabel = (n: number) => localize(
	'positron.notebook.showMoreLines',
	"Show {0} more lines",
	n.toLocaleString()
);
const showMoreLinesEllipsisLabel = (n: number) => localize(
	'positron.notebook.showMoreLinesEllipsis',
	"... Show {0} more lines",
	n.toLocaleString()
);
const showLessLabel = localize('positron.notebook.showLess', "Show less");

/** Shared fields for modes where the content exceeds the line limit. */
interface TruncationSplit {
	contentHead: string;
	contentTail: string;
	numLinesTruncated: number;
}

type TruncationResult =
	{ mode: 'normal'; content: string } |
	({ mode: 'truncate' } & TruncationSplit) |
	({ mode: 'full'; contentMiddle: string } & TruncationSplit);

function truncateToNumberOfLines(content: string, outputScrolling: boolean, maxLines: number): TruncationResult {
	// Trim newline from end of content if it exists.
	const splitByLine = content.trimEnd().split('\n');
	const numLines = splitByLine.length;

	// Content is short enough -- no truncation needed.
	if (numLines <= maxLines) {
		return { content, mode: 'normal' };
	}

	// Split point: 50/50 between top and bottom
	const topLines = Math.ceil(maxLines / 2);
	const bottomLines = maxLines - topLines;
	const contentHead = splitByLine.slice(0, topLines).join('\n');
	const contentTail = splitByLine.slice(numLines - bottomLines).join('\n');
	const numLinesTruncated = numLines - maxLines;

	// Content exceeds limit but scrolling is enabled -- show full output with
	// a "show less" button at the split point.
	if (outputScrolling) {
		return {
			mode: 'full',
			contentHead,
			contentMiddle: splitByLine.slice(topLines, numLines - bottomLines).join('\n'),
			contentTail,
			numLinesTruncated,
		};
	}

	return { mode: 'truncate', contentHead, contentTail, numLinesTruncated };
}

export interface CellTextOutputProps extends ParsedTextOutput {
	outputScrolling: boolean;
	onShowFullOutput: () => void;
	onTruncateOutput: () => void;
}


export function CellTextOutput({
	content,
	type,
	outputScrolling,
	onShowFullOutput,
	onTruncateOutput,
}: CellTextOutputProps) {

	const layoutConfig = useNotebookOptions().getLayoutConfiguration();
	const truncation = truncateToNumberOfLines(content, outputScrolling, layoutConfig.outputLineLimit);
	const outputWordWrap = layoutConfig.outputWordWrap;
	const services = usePositronReactServicesContext();
	const messageStyle = services.configurationService.getValue<TruncationMessageStyle>(TRUNCATION_MESSAGE_STYLE_SETTING) ?? 'chevron';

	return <>
		<div className={positronClassNames(
			`notebook-${type}`,
			'positron-notebook-text-output',
			{ 'word-wrap': outputWordWrap },
		)}>
			{truncation.mode === 'normal'
				? <OutputLines outputLines={ANSIOutput.processOutput(truncation.content)} />
				: <>
					<OutputLines outputLines={ANSIOutput.processOutput(truncation.contentHead)} />
					{truncation.mode === 'truncate'
						? <TruncationMessage
							messageStyle={messageStyle}
							numLinesTruncated={truncation.numLinesTruncated}
							onShowFullOutput={onShowFullOutput}
						/>
						: <>
							<ShowLessMessage onTruncateOutput={onTruncateOutput} />
							<OutputLines outputLines={ANSIOutput.processOutput(truncation.contentMiddle)} />
						</>
					}
					<OutputLines outputLines={ANSIOutput.processOutput(truncation.contentTail)} />
				</>
			}
		</div>
		{type === 'error' && <NotebookCellQuickFix errorContent={content} />}
	</>;
}

const TruncationMessage = ({ messageStyle, numLinesTruncated, onShowFullOutput }: {
	messageStyle: TruncationMessageStyle;
	numLinesTruncated: number;
	onShowFullOutput: () => void;
}) => {
	const instance = useNotebookInstance();
	const useChevron = messageStyle === 'chevron';
	const label = useChevron
		? showMoreLinesChevronLabel(numLinesTruncated)
		: showMoreLinesEllipsisLabel(numLinesTruncated);
	return <Button
		ariaLabel={label}
		className='notebook-output-truncation-message'
		hoverManager={instance.hoverManager}
		onPressed={onShowFullOutput}
	>
		{useChevron && <span className='codicon codicon-chevron-right truncation-chevron' />}
		{label}
	</Button>;
};

const ShowLessMessage = ({ onTruncateOutput }: {
	onTruncateOutput: () => void;
}) => {
	return <div
		aria-label={showLessLabel}
		className='notebook-output-show-less-seam'
		role='button'
		tabIndex={0}
		onClick={onTruncateOutput}
		onKeyDown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				onTruncateOutput();
			}
		}}
	>
		<span className='show-less-line' />
		<span className='show-less-label'>
			<ThemeIcon className='show-less-icon' icon={Codicon.fold} />
			<span className='show-less-text'>{showLessLabel}</span>
		</span>
	</div>;
};
