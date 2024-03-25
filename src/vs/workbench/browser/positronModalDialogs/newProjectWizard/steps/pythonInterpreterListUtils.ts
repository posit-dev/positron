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

const getPythonRuntimeComboBoxItems = (runtimeLanguageService: IRuntimeStartupService, languageRuntimeService: ILanguageRuntimeService, pythonRuntimeFilter = PythonRuntimeFilter.All): (DropDownListBoxItem | DropDownListBoxSeparator)[] => {
	// See ILanguageRuntimeMetadata in src/vs/workbench/services/languageRuntime/common/languageRuntimeService.ts
	// for the properties of the runtime metadata object
	const languageId = 'python';
	const preferredRuntime = runtimeLanguageService.getPreferredRuntime(languageId);
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
		comboBoxItems.push(new DropDownListBoxSeparator());
		comboBoxItems.push(...runtimeItems);
	});

	return comboBoxItems;
};

export const createCondaInterpreterComboBoxItems = () => {
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

export const createVenvInterpreterComboBoxItems = (runtimeLanguageService: IRuntimeStartupService, languageRuntimeService: ILanguageRuntimeService) => {
	return getPythonRuntimeComboBoxItems(runtimeLanguageService, languageRuntimeService, PythonRuntimeFilter.Global);
};

export const createPythonInterpreterComboBoxItems = (runtimeLanguageService: IRuntimeStartupService, languageRuntimeService: ILanguageRuntimeService) => {
	return getPythonRuntimeComboBoxItems(runtimeLanguageService, languageRuntimeService, PythonRuntimeFilter.All);
};
