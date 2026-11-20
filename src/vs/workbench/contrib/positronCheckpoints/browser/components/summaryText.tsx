/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

interface ISummaryTextProps {
	text: string;
}

/**
 * The lines of a summary, with the list marker (`- ` or `* `) of each line removed and empty
 * lines left out.
 */
export function summaryLines(text: string): string[] {
	return text.split('\n').map(line => line.trim().replace(/^[-*]\s+/, '')).filter(line => line !== '');
}

/**
 * A summary written by the agent or by a person: a list when it has several lines, and a
 * paragraph when it has one.
 */
export const SummaryText = ({ text }: ISummaryTextProps) => {
	const lines = summaryLines(text);
	if (lines.length <= 1) {
		return <p className='checkpoints-description'>{lines[0] ?? ''}</p>;
	}
	return (
		<ul className='checkpoints-description checkpoints-summary-list'>
			{lines.map((line, index) => <li key={index}>{line}</li>)}
		</ul>
	);
};
