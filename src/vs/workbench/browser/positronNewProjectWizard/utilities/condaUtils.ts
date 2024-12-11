/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxItem } from '../../positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { PythonEnvironmentProvider } from '../interfaces/newProjectWizardEnums.js';
import { InterpreterInfo } from './interpreterDropDownUtils.js';

/**
 * CondaPythonVersionInfo interface.
 */
export interface CondaPythonVersionInfo {
	preferred: string;
	versions: string[];
}

/**
 * Empty CondaPythonVersionInfo object.
 */
export const EMPTY_CONDA_PYTHON_VERSION_INFO: CondaPythonVersionInfo = {
	preferred: '',
	versions: [],
};

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
