/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxEntry } from '../../positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { DropDownListBoxSeparator } from '../../positronComponents/dropDownListBox/dropDownListBoxSeparator.js';
import { getRuntimeDisplayPath, ILanguageRuntimeMetadata } from '../../../services/languageRuntime/common/languageRuntimeService.js';

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
 * Determines whether a runtime is a valid seed for creating a new virtual environment.
 *
 * Reads the `isValidVenvSeed` flag stamped into extraRuntimeData by the Python extension,
 * which encodes the full seed-eligibility policy (Base or Externally Managed interpreter,
 * minus env types that are unsafe to spawn from the raw path, e.g. environment-module
 * Pythons that must launch with their module loaded). The extension stamps the flag on
 * every Python runtime it registers, and discovery cache schema v4 discards entries
 * written before the flag existed, so an absent flag means a non-Python runtime.
 * @param runtime The runtime to check.
 * @returns True if the runtime is a valid venv seed, false otherwise.
 */
export const isValidVenvSeed = (runtime: ILanguageRuntimeMetadata): boolean => {
	const extraData = runtime.extraRuntimeData as { isValidVenvSeed?: boolean } | undefined;
	return extraData?.isValidVenvSeed === true;
};

/**
 * Converts an array of interpreters to DropDownListBoxItems, filtering and grouping the list by
 * runtime source if requested.
 * @param interpreters The interpreters to convert to DropDownListBoxItems.
 * @param preferredRuntimeId The runtime ID of the preferred interpreter.
 * @returns An array of DropDownListBoxEntry for the interpreters.
 */
export const interpretersToDropdownItems = (
	interpreters: ILanguageRuntimeMetadata[],
	preferredRuntimeId?: string,
) => {
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
							runtimePath: getRuntimeDisplayPath(runtime),
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
