/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DropDownListBoxEntry } from '../../positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { DropDownListBoxSeparator } from '../../positronComponents/dropDownListBox/dropDownListBoxSeparator.js';
import { ILanguageRuntimeMetadata } from '../../../services/languageRuntime/common/languageRuntimeService.js';

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
