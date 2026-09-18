/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxItem } from '../../positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { PythonEnvironmentProvider } from '../interfaces/newFolderFlowEnums.js';
import { InterpreterInfo } from './interpreterDropDownUtils.js';

/**
 * UvPythonVersionInfo interface.
 */
export interface UvPythonVersionInfo {
	versions: string[];
}

/**
 * Result of the 'python.ensureUvInstalled' command. Mirrors EnsureUvResult in the Python
 * extension (uvPythonInstaller.ts) and has to be updated with it: ok is true if uv is installed
 * (or was already), and error carries a message to show when the install failed for a reason
 * other than the user declining.
 */
export interface EnsureUvResult {
	ok: boolean;
	error?: string;
}

/**
 * Empty UvPythonVersionInfo object.
 */
export const EMPTY_UV_PYTHON_VERSION_INFO: UvPythonVersionInfo = {
	versions: [],
};

/**
 * Converts a UvPythonVersionInfo object to DropDownListBoxItem objects.
 * Like Conda, uv environments have special handling because the Python interpreters don't exist until the uv
 * environment is created. As such, we only have the python versions available to us at this point.
 * @param versionInfo The UvPythonVersionInfo object to convert.
 * @returns The array of DropDownListBoxItem objects.
 */
export const uvInterpretersToDropdownItems = (
	versionInfo: UvPythonVersionInfo | undefined
) => {
	if (!versionInfo) {
		return [];
	}
	return versionInfo.versions.map(
		(version: string) =>
			new DropDownListBoxItem<string, InterpreterInfo>({
				identifier: version,
				value: {
					preferred: false,
					runtimeId: version,
					languageName: 'Python',
					languageVersion: version,
					runtimePath: '',
					runtimeSource: PythonEnvironmentProvider.Uv,
				},
			})
	);
};
