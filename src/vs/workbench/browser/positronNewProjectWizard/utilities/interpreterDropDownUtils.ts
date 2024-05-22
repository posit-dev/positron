/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxEntry } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { DropDownListBoxSeparator } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxSeparator';
import { ILanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

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
 * Converts an array of interpreters to DropDownListBoxItems, filtering and grouping the list by
 * runtime source if requested.
 * @param interpreters The interpreters to convert to DropDownListBoxItems.
 * @param preferredRuntimeId The runtime ID of the preferred interpreter.
 * @param isConda A temporary flag to retrieve hardcoded Conda interpreters.
 * @returns An array of DropDownListBoxEntry for the interpreters.
 */
export const interpretersToDropdownItems = (
	interpreters: ILanguageRuntimeMetadata[],
	preferredRuntimeId?: string,
	isConda?: boolean
) => {
	if (isConda) {
		// TODO: we should get the list of Python versions from the Conda service via the new project
		// wizard state. For now, we'll hardcode the list of Python versions.
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
	}

	// Return the DropDownListBoxEntry array.
	return interpreters
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
