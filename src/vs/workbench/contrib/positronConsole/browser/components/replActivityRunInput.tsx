/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./replActivityRunInput';
import * as React from 'react';
import { ReplLines } from 'vs/workbench/contrib/positronConsole/browser/components/replLines';
import { ActivityItemInput } from 'vs/workbench/contrib/positronConsole/browser/classes/activityItemInput';

// ReplActivityRunInputProps interface.
export interface ReplActivityRunInputProps {
	replItemActivityRunInput: ActivityItemInput;
}

/**
 * ReplActivityRunInput component.
 * @param props A ReplActivityRunInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ReplActivityRunInput = ({ replItemActivityRunInput }: ReplActivityRunInputProps) => {
	// Render.
	return (
		<div className='repl-activity-run-input'>
			<div className='prompt'>&gt;</div>
			<ReplLines {...replItemActivityRunInput} />
		</div>
	);
};
