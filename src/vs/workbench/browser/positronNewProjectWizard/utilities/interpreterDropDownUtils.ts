/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxEntry } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { DropDownListBoxSeparator } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxSeparator';
import { LanguageIds, PythonRuntimeFilter } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { ILanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
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
 * Determines if the runtime source should be included based on the filters.
 * @param runtimeSource The runtime source to check.
 * @param filters The runtime source filters to apply.
 * @returns True if the runtime source should be included, false otherwise.
 * If no filters are provided, all runtime sources are included.
 */
const includeRuntimeSource = (
	runtimeSource: string,
	filters?: RuntimeFilter[]
) => {
	return (
		!filters ||
		!filters.length ||
		filters.find((rs) => rs === runtimeSource) !== undefined
	);
};

/**
 * Converts an array of interpreters to DropDownListBoxItems, filtering and grouping the list by
 * runtime source if requested.
 * @param interpreters The interpreters to convert to DropDownListBoxItems.
 * @param languageId The language ID of the runtime to retrieve interpreters for.
 * @param preferredRuntimeId The runtime ID of the preferred interpreter.
 * @param runtimeSourceFilters The runtime source filters to apply to the runtimes.
 * @returns An array of DropDownListBoxEntry for the interpreters.
 */
export const interpretersToDropdownItems = (
	interpreters: ILanguageRuntimeMetadata[],
	languageId: LanguageIds,
	preferredRuntimeId: string,
	runtimeSourceFilters?: RuntimeFilter[]
) => {
	// Return the DropDownListBoxEntry array.
	return interpreters
		.filter(
			(runtime) =>
				runtime.languageId === languageId &&
				includeRuntimeSource(runtime.runtimeSource, runtimeSourceFilters)
		)
		.sort((left, right) =>
			left.runtimeSource.localeCompare(right.runtimeSource)
		)
		.reduce<DropDownListBoxEntry<string, InterpreterInfo>[]>(
			(entries, runtime, index, runtimes) => {
				// Perform break processing when the runtime source changes.
				if (
					index &&
					runtimes[index].runtimeSource !== runtimes[index - 1].runtimeSource
				) {
					entries.push(new DropDownListBoxSeparator());
				}

				// Push the DropDownListBoxItem.
				entries.push(
					new DropDownListBoxItem<string, InterpreterInfo>({
						identifier: runtime.runtimeId,
						value: {
							preferred: runtime.runtimeId === preferredRuntimeId,
							runtimeId: runtime.runtimeId,
							languageName: runtime.languageName,
							languageVersion: runtime.languageVersion,
							runtimePath: runtime.runtimePath,
							runtimeSource: runtime.runtimeSource,
						},
					})
				);

				// Return the entries for the next iteration.
				return entries;
			},
			[]
		);
};

/**
 * Retrieves the runtimeId of the preferred interpreter for the given languageId.
 * @param runtimeStartupService The runtime startup service.
 * @param languageId The languageId of the runtime to retrieve.
 * @returns The preferred interpreter or undefined if no preferred runtime is found.
 */
export const getPreferredRuntime = (
	runtimeStartupService: IRuntimeStartupService,
	languageId: LanguageIds
) => {
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
 * Determines if the interpreter is in the dropdown list.
 * @param interpreter The interpreter to check.
 * @param interpreterEntries The interpreter entries.
 * @returns True if the interpreter is in the dropdown list, false otherwise.
 */
const isInterpreterInDropdown = (
	interpreter: ILanguageRuntimeMetadata | undefined,
	interpreterEntries: DropDownListBoxEntry<string, InterpreterInfo>[]
) => {
	if (!interpreter || !interpreterEntries.length) {
		return false;
	}
	return interpreterEntries.find((entry) => {
		if (entry instanceof DropDownListBoxItem) {
			return entry.options.identifier === interpreter.runtimeId;
		}
		return false;
	});
};

/**
 * Retrieves the selected interpreter for the given languageId if it is a valid option in the
 * dropdown list.
 * @param existingSelection The existing selection.
 * @param interpreterEntries The interpreter entries.
 * @param runtimeStartupService The runtime startup service.
 * @param languageId The languageId of the runtime to retrieve.
 * @returns The already selected interpreter if it matches the languageId, the preferred interpreter
 * if it exists, or undefined if no preferred interpreter is found.
 */
export const getSelectedInterpreter = (
	existingSelection: ILanguageRuntimeMetadata | undefined,
	interpreterEntries: DropDownListBoxEntry<string, InterpreterInfo>[],
	runtimeStartupService: IRuntimeStartupService,
	languageId: LanguageIds
) => {
	// Return the existing selection if it is in the dropdown list.
	if (isInterpreterInDropdown(existingSelection, interpreterEntries)) {
		return existingSelection;
	}

	// Return the preferred interpreter if it is in the dropdown list.
	const preferredInterpreter = getPreferredRuntime(
		runtimeStartupService,
		languageId
	);
	if (isInterpreterInDropdown(preferredInterpreter, interpreterEntries)) {
		return preferredInterpreter;
	}

	// Otherwise, there doesn't appear to be a valid selection.
	return undefined;
};
