/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxEntry } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { DropDownListBoxSeparator } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxSeparator';
import { LanguageIds, PythonRuntimeFilter } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

/**
 * RuntimeFilter type.
 * More filters can be added here as needed.
 */
type RuntimeFilter = PythonRuntimeFilter;

/**
 * InterpreterInfo interface.
 */
export interface InterpreterInfo {
	preferred: boolean;
	runtimeId: string;
	languageName: string;
	languageVersion: string;
	runtimePath: string;
	runtimeSource: string;
}

/**
 * Retrieves the detected interpreters as DropDownListBoxItems, filtering and grouping the list by
 * runtime source if requested.
 * @param languageRuntimeService The language runtime service.
 * @param languageId The language ID of the runtime to retrieve interpreters for.
 * @param preferredRuntimeId The runtime ID of the preferred interpreter.
 * @param runtimeSourceFilter The runtime source filter to apply to the runtimes.
 * @returns An array of DropDownListBoxEntry for the interpreters.
 */
export const getInterpreterDropdownItems = (
	languageRuntimeService: ILanguageRuntimeService,
	languageId: LanguageIds,
	preferredRuntimeId: string,
	runtimeSourceFilter?: RuntimeFilter
) => {
	// Return the DropDownListBoxEntry array.
	return languageRuntimeService.registeredRuntimes
		.filter(runtime => runtime.languageId === languageId &&
			(!runtimeSourceFilter || runtime.runtimeSource === runtimeSourceFilter)
		)
		.sort((left, right) => left.runtimeSource.localeCompare(right.runtimeSource))
		.reduce<DropDownListBoxEntry<string, InterpreterInfo>[]>(
			(entries, runtime, index, runtimes) => {
				// Perform break processing when the runtime source changes.
				if (index && runtimes[index].runtimeSource !== runtimes[index - 1].runtimeSource) {
					entries.push(new DropDownListBoxSeparator());
				}

				// Push the DropDownListBoxItem.
				entries.push(new DropDownListBoxItem<string, InterpreterInfo>({
					identifier: runtime.runtimeId,
					value: {
						preferred: runtime.runtimeId === preferredRuntimeId,
						runtimeId: runtime.runtimeId,
						languageName: runtime.languageName,
						languageVersion: runtime.languageVersion,
						runtimePath: runtime.runtimePath,
						runtimeSource: runtime.runtimeSource
					}
				}));

				// Return the entries for the next iteration.
				return entries;
			}, []
		);
};

/**
 * Retrieves the runtimeId of the preferred interpreter for the given languageId.
 * @param runtimeStartupService The runtime startup service.
 * @param languageId The languageId of the runtime to retrieve.
 * @returns The preferred interpreter or undefined if no preferred runtime is found.
 */
export const getPreferredRuntime = (runtimeStartupService: IRuntimeStartupService, languageId: LanguageIds) => {
	let preferredRuntime;
	try {
		preferredRuntime = runtimeStartupService.getPreferredRuntime(languageId);
	} catch (error) {
		// Ignore the error if the preferred runtime is not found. This can happen if the interpreters
		// are still being loaded.
	}
	return preferredRuntime;
};

/**
 * Retrieves the selected interpreter for the given languageId.
 * @param existingSelection The existing selection.
 * @param runtimeStartupService The runtime startup service.
 * @param languageId The languageId of the runtime to retrieve.
 * @returns The already selected interpreter if it matches the languageId, the preferred interpreter
 * if it exists, or undefined if no preferred interpreter is found.
 */
export const getSelectedInterpreter = (
	existingSelection: ILanguageRuntimeMetadata | undefined,
	runtimeStartupService: IRuntimeStartupService,
	languageId: LanguageIds
) => {
	return existingSelection?.languageId === languageId ?
		existingSelection :
		getPreferredRuntime(runtimeStartupService, languageId);
};
