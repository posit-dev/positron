/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { InterpreterInfo } from 'vs/workbench/browser/positronNewProjectWizard/utilities/interpreterDropDownUtils';
import { DropdownEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/dropdownEntry';

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
			title={`${interpreterInfo.languageName} ${interpreterInfo.languageVersion}`}
			subtitle={`${interpreterInfo.runtimePath}`}
			group={interpreterInfo.runtimeSource}
		/>
	);
};
