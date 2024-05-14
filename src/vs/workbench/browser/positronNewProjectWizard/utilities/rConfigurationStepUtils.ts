/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { LanguageIds } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { interpretersToDropdownItems } from 'vs/workbench/browser/positronNewProjectWizard/utilities/interpreterDropDownUtils';
import { ILanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

/**
 * Returns a DropDownListBoxEntry array for R interpreters, filtering and grouping the list by
 * runtime source if requested.
 * @param interpreters The interpreters to convert to dropdown items.
 * @param runtimeStartupService The runtime startup service.
 * @returns An array of DropDownListBoxEntry for R interpreters.
 */
export const getRInterpreterEntries = (
	interpreters: ILanguageRuntimeMetadata[],
	runtimeStartupService: IRuntimeStartupService
) => {
	const languageId = LanguageIds.R;
	const preferredRuntime = runtimeStartupService.getPreferredRuntime(languageId);

	return interpretersToDropdownItems(
		interpreters,
		languageId,
		preferredRuntime?.runtimeId
	);
};
