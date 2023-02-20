/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./replLines';
import * as React from 'react';
import { Line } from 'vs/workbench/contrib/positronConsole/browser/classes/utils';
import { ReplLine } from 'vs/workbench/contrib/positronConsole/browser/components/replLine';

// ReplLinesProps interface.
export interface ReplLinesProps {
	// The lines.
	readonly lines: readonly Line[];
}

/**
 * ReplLines component.
 * @param props A ReplLinesProps that contains the component properties.
 * @returns The rendered component.
 */
export const ReplLines = ({ lines }: ReplLinesProps) => {
	// Render.
	return (
		<div className='repl-lines'>
			{lines.map(line =>
				<ReplLine key={line.id} text={line.text} />
			)}
		</div>
	);
};
