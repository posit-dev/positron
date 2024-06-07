/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { PythonEnvironmentProvider } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { InterpreterInfo } from 'vs/workbench/browser/positronNewProjectWizard/utilities/interpreterDropDownUtils';

/**
 * CondaPythonVersionInfo interface.
 */
export interface CondaPythonVersionInfo {
	preferred: string;
	versions: string[];
}

/**
 * Converts a CondaPythonVersionInfo object to DropDownListBoxItem objects.
 * Conda environments have special handling because the Python interpreters exist until the conda
 * environment is created. As such, we only have the python versions available to us at this point.
 * @param versionInfo The CondaPythonVersionInfo object to convert.
 * @returns The array of DropDownListBoxItem objects.
 */
export const condaInterpretersToDropdownItems = (
	versionInfo: CondaPythonVersionInfo | undefined
) => {
	if (!versionInfo) {
		return [];
	}
	return versionInfo.versions.map(
		(version: string) =>
			new DropDownListBoxItem<string, InterpreterInfo>({
				identifier: version,
				value: {
					preferred: version === versionInfo.preferred,
					runtimeId: version,
					languageName: 'Python',
					languageVersion: version,
					runtimePath: '',
					runtimeSource: PythonEnvironmentProvider.Conda,
				},
			})
	);
};
