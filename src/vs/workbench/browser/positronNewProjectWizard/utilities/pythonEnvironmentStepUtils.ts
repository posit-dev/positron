/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { EnvironmentSetupType, LanguageIds, PythonEnvironmentType, PythonRuntimeFilter } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { InterpreterInfo, getInterpreterDropdownItems } from 'vs/workbench/browser/positronNewProjectWizard/utilities/interpreterDropDownUtils';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

/**
 * PythonEnvironmentTypeInfo interface.
 */
export interface PythonEnvironmentTypeInfo {
	envType: PythonEnvironmentType;
	envDescription: string;
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
	const preferredRuntime = runtimeStartupService.getPreferredRuntime(languageId);

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
	const pythonVersions = ['3.12', '3.11', '3.10', '3.9', '3.8'];
	const condaRuntimes: DropDownListBoxItem<string, InterpreterInfo>[] = [];
	pythonVersions.forEach(version => {
		condaRuntimes.push(new DropDownListBoxItem<string, InterpreterInfo>({
			identifier: `conda-python-${version}`,
			value: {
				preferred: version === '3.12',
				runtimeId: `conda-python-${version}`,
				languageName: 'Python',
				languageVersion: version,
				runtimePath: '',
				runtimeSource: 'Conda'
			}
		}));
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
	envType: PythonEnvironmentType | undefined
) => {
	switch (envSetupType) {
		case EnvironmentSetupType.NewEnvironment:
			switch (envType) {
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
						languageRuntimeService,
					);
			}
		case EnvironmentSetupType.ExistingEnvironment:
			return getPythonInterpreterDropDownItems(
				runtimeStartupService,
				languageRuntimeService,
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
	envType: PythonEnvironmentType | undefined
) => {
	// TODO: this only works for Venv and Conda environments. We'll need to expand on this to add
	// support for other environment types.
	const envDir = envType === PythonEnvironmentType.Venv
		? '.venv'
		: envType === PythonEnvironmentType.Conda
			? '.conda'
			: '';
	return `${parentFolder}/${projectName}/${envDir}`;
};

/**
 * Constructs and returns the entries for the environment type dropdown box.
 * @returns The entries for the environment type dropdown box.
 */
export const getEnvTypeEntries = () => {
	// TODO: retrieve the python environment types from the language runtime service somehow?
	// TODO: localize these entries
	return [
		new DropDownListBoxItem<PythonEnvironmentType, PythonEnvironmentTypeInfo>({
			identifier: PythonEnvironmentType.Venv,
			value: {
				envType: PythonEnvironmentType.Venv,
				envDescription: 'Creates a `.venv` virtual environment for your project'
			}
		}),
		new DropDownListBoxItem<PythonEnvironmentType, PythonEnvironmentTypeInfo>({
			identifier: PythonEnvironmentType.Conda,
			value: {
				envType: PythonEnvironmentType.Conda,
				envDescription: 'Creates a `.conda` Conda environment for your project'
			}
		})
	];
};
