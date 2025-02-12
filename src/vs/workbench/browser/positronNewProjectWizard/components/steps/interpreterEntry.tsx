/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { InterpreterInfo } from '../../utilities/interpreterDropDownUtils.js';
import { DropdownEntry } from './dropdownEntry.js';

/**
 * InterpreterEntryProps interface.
 */
interface InterpreterEntryProps {
	interpreterInfo: InterpreterInfo;
}

/**
 * InterpreterEntry component.
 * @param interpreterInfo The Python interpreter info.
 * @returns The rendered component
 */
export const InterpreterEntry = ({ interpreterInfo }: InterpreterEntryProps) => {
	// Render.
	return (
		<DropdownEntry
			codicon={interpreterInfo.preferred ? 'codicon-star-full' : undefined}
			group={interpreterInfo.runtimeSource}
			subtitle={`${interpreterInfo.runtimePath}`}
			title={`${interpreterInfo.languageName} ${interpreterInfo.languageVersion}`}
		/>
	);
};
