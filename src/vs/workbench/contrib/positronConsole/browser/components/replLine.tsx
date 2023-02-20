/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./replLine';
import * as React from 'react';

// ReplLineProps interface.
export interface ReplLineProps {
	text: string;
}

/**
 * ReplLine component.
 * @param props A ReplLineProps that contains the component properties.
 * @returns The rendered component.
 */
export const ReplLine = ({ text }: ReplLineProps) => {
	// Render.
	return (
		<div className='repl-line'>
			{!text.length ? <br /> : <div>{text}</div>}
		</div>
	);
};
