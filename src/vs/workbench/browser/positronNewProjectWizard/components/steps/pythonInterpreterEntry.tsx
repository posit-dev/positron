/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./pythonInterpreterEntry';

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
			// allow-any-unicode-next-line
			icon={interpreterInfo.preferred ? '★' : ''}
			title={`${interpreterInfo.languageName} ${interpreterInfo.languageVersion}`}
			subtitle={`${interpreterInfo.runtimePath}`}
			group={interpreterInfo.runtimeSource}
		/>
	);
};
