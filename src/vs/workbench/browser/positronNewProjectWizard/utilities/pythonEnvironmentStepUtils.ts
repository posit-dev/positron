/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILogService } from 'vs/platform/log/common/log';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { EnvironmentSetupType, LanguageIds, PythonEnvironmentType, PythonRuntimeFilter } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { InterpreterInfo, getInterpreterDropdownItems } from 'vs/workbench/browser/positronNewProjectWizard/utilities/interpreterDropDownUtils';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

/**
 * PythonEnvironmentProviderInfo interface.
 */
export interface PythonEnvironmentProviderInfo {
	id: string;
	name: string;
	description: string;
}

/**
 * Retrieves the detected Python interpreters as DropDownListBoxItems, filtering and grouping the
 * list by runtime source if requested.
 * @param runtimeStartupService The runtime startup service.
 * @param languageRuntimeService The language runtime service.
 * @param pythonRuntimeFilters The PythonRuntimeFilters to apply to the Python runtimes.
 * @returns An array of DropDownListBoxEntry for Python interpreters.
 */
const getPythonInterpreterDropDownItems = (
	runtimeStartupService: IRuntimeStartupService,
	languageRuntimeService: ILanguageRuntimeService,
	pythonRuntimeFilters?: PythonRuntimeFilter[]
) => {
	const languageId = LanguageIds.Python;
	const preferredRuntime =
		runtimeStartupService.getPreferredRuntime(languageId);

	return getInterpreterDropdownItems(
		languageRuntimeService,
		languageId,
		preferredRuntime?.runtimeId,
		pythonRuntimeFilters
	);
};

/**
 * Creates an array of DropDownListBoxItem of Python interpreters for each Conda-supported minor
 * Python version.
 * @returns An array of DropDownListBoxItem for Conda Python interpreters.
 */
export const createCondaInterpreterDropDownItems = () => {
	// TODO: we should get the list of Python versions from the Conda service
	// see extensions/positron-python/src/client/pythonEnvironments/creation/provider/condaUtils.ts
	// pickPythonVersion function
	const pythonVersions = ['3.12', '3.11', '3.10', '3.9', '3.8'];
	const condaRuntimes: DropDownListBoxItem<string, InterpreterInfo>[] = [];
	pythonVersions.forEach((version) => {
		condaRuntimes.push(
			new DropDownListBoxItem<string, InterpreterInfo>({
				identifier: `conda-python-${version}`,
				value: {
					preferred: version === '3.12',
					runtimeId: `conda-python-${version}`,
					languageName: 'Python',
					languageVersion: version,
					runtimePath: '',
					runtimeSource: 'Conda',
				},
			})
		);
	});
	return condaRuntimes;
};

/**
 * Gets the Python interpreter entries based on the environment setup type and environment type.
 * @param runtimeStartupService The runtime startup service.
 * @param languageRuntimeService The language runtime service.
 * @param envSetupType The environment setup type.
 * @param envType The environment type.
 * @returns An array of DropDownListBoxItem and DropDownListBoxSeparator for Python interpreters.
 */
export const getPythonInterpreterEntries = (
	runtimeStartupService: IRuntimeStartupService,
	languageRuntimeService: ILanguageRuntimeService,
	envSetupType: EnvironmentSetupType,
	envProviderName: string | undefined,
) => {
	switch (envSetupType) {
		case EnvironmentSetupType.NewEnvironment: {
			switch (envProviderName) {
				case PythonEnvironmentType.Venv:
					return getPythonInterpreterDropDownItems(
						runtimeStartupService,
						languageRuntimeService,
						[PythonRuntimeFilter.Global, PythonRuntimeFilter.Pyenv]
					);
				case PythonEnvironmentType.Conda:
					return createCondaInterpreterDropDownItems();
				default:
					return getPythonInterpreterDropDownItems(
						runtimeStartupService,
						languageRuntimeService
					);
			}
		}
		case EnvironmentSetupType.ExistingEnvironment:
			return getPythonInterpreterDropDownItems(
				runtimeStartupService,
				languageRuntimeService
			);
		default:
			return [];
	}
};

/**
 * Constructs the location for the new Python environment based on the parent folder, project name,
 * and environment type.
 * @param parentFolder The parent folder for the new environment.
 * @param projectName The name of the project.
 * @param envType The type of Python environment.
 * @returns The location for the new Python environment.
 */
export const locationForNewEnv = (
	parentFolder: string,
	projectName: string,
	envProviderName: string | undefined,
) => {
	// TODO: this only works for Venv and Conda environments. We'll need to expand on this to add
	// support for other environment types.
	const envDir =
		envProviderName === PythonEnvironmentType.Venv
			? '.venv'
			: envProviderName === PythonEnvironmentType.Conda
				? '.conda'
				: '';
	return `${parentFolder}/${projectName}/${envDir}`;
};

/**
 * Constructs and returns the entries for the environment providers dropdown box.
 * @returns The entries for the environment providers dropdown box.
 */
export const getEnvProviderInfoList = async (
	commandService: ICommandService,
	logService: ILogService,
): Promise<PythonEnvironmentProviderInfo[]> => {
	const envTypes = await commandService.executeCommand(
		'python.getCreateEnvironmentProviders'
	);
	if (!envTypes) {
		logService.debug('No Python Create Environment Providers found.');
		return [];
	}
	return envTypes;
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
