/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxEntry } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { DropDownListBoxSeparator } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxSeparator';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

export enum PythonRuntimeFilter {
	All = 'All',        // Include all runtimes. This is when an existing Python installation is to be used.
	Global = 'Global',  // Include only global runtimes. This is when a new Venv environment is being created.
}

/**
 * PythonInterpreterInfo interface.
 */
export interface PythonInterpreterInfo {
	preferred: boolean;
	runtimeId: string;
	languageName: string;
	languageVersion: string;
	runtimePath: string;
	runtimeSource: string;
}

/**
 * Retrieves the detected Python interpreters as DropDownListBoxItems, filtering and grouping the
 * list by runtime source if requested.
 * @param runtimeStartupService The runtime startup service.
 * @param languageRuntimeService The language runtime service.
 * @param pythonRuntimeFilter The PythonRuntimeFilter to apply to the Python runtimes.
 * @returns An array of DropDownListBoxEntry for Python interpreters.
 */
const getPythonInterpreterDropDownItems = (
	runtimeStartupService: IRuntimeStartupService,
	languageRuntimeService: ILanguageRuntimeService,
	pythonRuntimeFilter = PythonRuntimeFilter.All
) => {
	// See ILanguageRuntimeMetadata in src/vs/workbench/services/languageRuntime/common/languageRuntimeService.ts
	// for the properties of the runtime metadata object
	const languageId = 'python';
	const preferredRuntime = runtimeStartupService.getPreferredRuntime(languageId);
	const all = pythonRuntimeFilter === PythonRuntimeFilter.All;

	// Return the DropDownListBoxEntry array.
	return languageRuntimeService.registeredRuntimes.
		filter(runtime => runtime.languageId === languageId &&
			(all || runtime.runtimeSource === pythonRuntimeFilter)
		).
		sort((left, right) => left.runtimeSource.localeCompare(right.runtimeSource)).
		reduce<DropDownListBoxEntry<string, PythonInterpreterInfo>[]>(
			(entries, runtime, index, runtimes) => {
				// Perform break processing when the runtime source changes.
				if (index && runtimes[index].runtimeSource !== runtimes[index - 1].runtimeSource) {
					entries.push(new DropDownListBoxSeparator());
				}

				// Push the DropDownListBoxItem.
				entries.push(new DropDownListBoxItem<string, PythonInterpreterInfo>({
					identifier: runtime.runtimeId,
					value: {
						preferred: runtime.runtimeId === preferredRuntime.runtimeId,
						runtimeId: runtime.runtimeId,
						languageName: runtime.languageName,
						languageVersion: runtime.languageVersion,
						runtimePath: runtime.runtimePath,
						runtimeSource: runtime.runtimeSource
					}
				}));

				// Return the entries for the next iteration.
				return entries;
			}, []);
};

/**
 * Creates an array of DropDownListBoxItem of Python interpreters for each Conda-supported minor
 * Python version.
 * @returns An array of DropDownListBoxItem for Conda Python interpreters.
 */
export const createCondaInterpreterDropDownItems = () => {
	// TODO: we should get the list of Python versions from the Conda service
	const pythonVersions = ['3.12', '3.11', '3.10', '3.9', '3.8'];
	const condaRuntimes: DropDownListBoxItem<string, string>[] = [];
	pythonVersions.forEach(version => {
		condaRuntimes.push(new DropDownListBoxItem({
			identifier: `conda-python-${version}`,
			title: `Python ${version}`,
			value: `conda-python-${version}`
		}));
	});
	return condaRuntimes;
};

/**
 * Creates an array of DropDownListBoxItem for Global Python interpreters.
 * @param runtimeStartupService The runtime startup service.
 * @param languageRuntimeService The language runtime service.
 * @returns An array of DropDownListBoxItem for Venv Python interpreters.
 */
export const createVenvInterpreterDropDownItems = (runtimeStartupService: IRuntimeStartupService, languageRuntimeService: ILanguageRuntimeService) => {
	return getPythonInterpreterDropDownItems(runtimeStartupService, languageRuntimeService, PythonRuntimeFilter.Global);
};

/**
 * Creates an array of DropDownListBoxItem and DropDownListBoxSeparator for all detected Python
 * interpreters, grouped by the runtime sources (Global, Venv, Conda, etc.).
 * @param runtimeStartupService The runtime startup service.
 * @param languageRuntimeService The language runtime service.
 * @returns An array of DropDownListBoxItem and DropDownListBoxSeparator.
 */
export const createPythonInterpreterDropDownItems = (runtimeStartupService: IRuntimeStartupService, languageRuntimeService: ILanguageRuntimeService) => {
	return getPythonInterpreterDropDownItems(runtimeStartupService, languageRuntimeService, PythonRuntimeFilter.All);
};
