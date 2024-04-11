/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./pythonInterpreterEntry';

// React.
import * as React from 'react';

// Other dependencies.
import { PythonInterpreterInfo } from 'vs/workbench/browser/positronNewProjectWizard/utilities/pythonEnvironmentStepUtils';
import { DropdownEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/dropdownEntry';

/**
 * PythonInterpreterEntryProps interface.
 */
interface PythonInterpreterEntryProps {
	pythonInterpreterInfo: PythonInterpreterInfo;
}

/**
 * PythonInterpreterEntry component.
 * @param pythonInterpreterInfo The Python interpreter info.
 * @returns The rendered component
 */
export const PythonInterpreterEntry = ({ pythonInterpreterInfo }: PythonInterpreterEntryProps) => {
	// Render.
	return (
		<DropdownEntry
			// allow-any-unicode-next-line
			icon={pythonInterpreterInfo.preferred ? '★' : ''}
			title={`${pythonInterpreterInfo.languageName} ${pythonInterpreterInfo.languageVersion}`}
			subtitle={`${pythonInterpreterInfo.runtimePath}`}
			group={pythonInterpreterInfo.runtimeSource}
		/>
	);
};
