/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxItem } from '../../positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { PythonEnvironmentProvider } from '../interfaces/newFolderFlowEnums.js';

/**
 * PythonEnvironmentProviderInfo interface.
 */
export interface PythonEnvironmentProviderInfo {
	id: string;
	name: string;
	description: string;
}

/**
 * Returns the default environment name for a given provider.
 * @param envProviderName The name of the Python environment provider.
 * @returns The default environment name.
 */
export const getDefaultEnvName = (envProviderName: string | undefined): string => {
	return envProviderName === PythonEnvironmentProvider.Conda ? '.conda' : '.venv';
};

/**
 * Constructs the location for the new Python environment based on the parent folder, project name,
 * and environment type.
 * @param parentFolder The parent folder for the new environment.
 * @param projectName The name of the project.
 * @param envProviderName The name of the Python environment provider.
 * @param customEnvName Optional custom environment name to use instead of the default.
 * @returns Array of strings representing the path to the new environment.
 */
export const locationForNewEnv = (
	parentFolder: string,
	projectName: string,
	envProviderName: string | undefined,
	customEnvName?: string,
) => {
	const envDir = customEnvName || getDefaultEnvName(envProviderName);
	return [parentFolder, projectName, envDir];
};

/**
 * Converts PythonEnvironmentProviderInfo objects to DropDownListBoxItem objects.
 * @param providers The PythonEnvironmentProviderInfo objects to convert.
 * @returns The array of DropDownListBoxItem objects.
 */
export const envProviderInfoToDropDownItems = (
	providers: PythonEnvironmentProviderInfo[]
): DropDownListBoxItem<string, PythonEnvironmentProviderInfo>[] => {
	return providers.map(
		(provider) =>
			new DropDownListBoxItem<string, PythonEnvironmentProviderInfo>({
				identifier: provider.id,
				value: provider,
			})
	);
};

/**
 * Retrieves the name of the environment provider based on the provider ID.
 * @param providerId The ID of the environment provider.
 * @param providers The list of environment providers.
 * @returns The name of the environment provider or undefined if not found.
 */
export const envProviderNameForId = (
	providerId: string | undefined,
	providers: PythonEnvironmentProviderInfo[]
): string | undefined => {
	if (!providerId) {
		return undefined;
	}
	const provider = providers.find((p) => p.id === providerId);
	return provider ? provider.name : undefined;
};
