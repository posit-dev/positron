/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { DropDownListBoxSeparator } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxSeparator';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

export enum PythonRuntimeFilter {
	All = 'All',        // Include all runtimes. This is when an existing Python installation is to be used.
	Global = 'Global',  // Include only global runtimes. This is when a new Venv environment is being created.
}

/**
 * Retrieves the detected Python interpreters as DropDownListBoxItems, filtering and grouping the
 * list by runtime source if requested.
 * @param runtimeStartupService The runtime startup service.
 * @param languageRuntimeService The language runtime service.
 * @param pythonRuntimeFilter The PythonRuntimeFilter to apply to the Python runtimes.
 * @returns An array of DropDownListBoxItem and DropDownListBoxSeparator for Python interpreters.
 */
const getPythonInterpreterDropDownItems = (runtimeStartupService: IRuntimeStartupService, languageRuntimeService: ILanguageRuntimeService, pythonRuntimeFilter = PythonRuntimeFilter.All): (DropDownListBoxItem | DropDownListBoxSeparator)[] => {
	// See ILanguageRuntimeMetadata in src/vs/workbench/services/languageRuntime/common/languageRuntimeService.ts
	// for the properties of the runtime metadata object
	const languageId = 'python';
	const preferredRuntime = runtimeStartupService.getPreferredRuntime(languageId);
	const discoveredRuntimes = languageRuntimeService.registeredRuntimes;
	const pythonRuntimes = discoveredRuntimes.filter(runtime => runtime.languageId === languageId);

	// Group the runtimes by runtimeSource.
	const runtimeSourceMap = new Map<string, DropDownListBoxItem[]>();
	pythonRuntimes.forEach((runtime) => {
		const runtimeSource = runtime.runtimeSource;
		// Only include runtimes that match the filter
		if (pythonRuntimeFilter === PythonRuntimeFilter.All || runtimeSource === pythonRuntimeFilter) {
			if (!runtimeSourceMap.has(runtimeSource)) {
				runtimeSourceMap.set(runtimeSource, []);
			}
			runtimeSourceMap.get(runtimeSource)?.push(new DropDownListBoxItem({
				identifier: runtime.runtimeId,
				// TODO: remove this eslint comment once the label is being constructed properly
				// allow-any-unicode-next-line
				title: `${runtime.runtimeId === preferredRuntime.runtimeId ? '★ ' : ''}${runtime.languageName} ${runtime.languageVersion} ---- ${runtime.runtimePath} ---- ${runtime.runtimeSource}`
			}));
		}
	});

	// Creates an array of DropDownListBoxItem and DropDownListBoxSeparator.
	// The DropDownListBoxSeparator is used to separate the runtimes by runtimeSource.
	const comboBoxItems: DropDownListBoxItem | DropDownListBoxSeparator[] = [];
	runtimeSourceMap.forEach((runtimeItems) => {
		if (comboBoxItems.length > 0) {
			comboBoxItems.push(new DropDownListBoxSeparator());
		}
		comboBoxItems.push(...runtimeItems);
	});

	return comboBoxItems;
};

/**
 * Creates an array of DropDownListBoxItem of Python interpreters for each Conda-supported minor
 * Python version.
 * @returns An array of DropDownListBoxItem for Conda Python interpreters.
 */
export const createCondaInterpreterDropDownItems = () => {
	// TODO: we should get the list of Python versions from the Conda service
	const pythonVersions = ['3.12', '3.11', '3.10', '3.9', '3.8'];
	const condaRuntimes: DropDownListBoxItem[] = [];
	pythonVersions.forEach(version => {
		condaRuntimes.push(new DropDownListBoxItem({
			identifier: `conda-python-${version}`,
			title: `Python ${version}`
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
