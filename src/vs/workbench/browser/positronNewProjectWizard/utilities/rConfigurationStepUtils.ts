/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { LanguageIds } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { getInterpreterDropdownItems, getPreferredRuntimeId } from 'vs/workbench/browser/positronNewProjectWizard/utilities/interpreterDropDownUtils';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

/**
 * Retrieves the detected R interpreters as DropDownListBoxItems, filtering and grouping the list by
 * runtime source if requested.
 * @param runtimeStartupService The runtime startup service.
 * @param languageRuntimeService The language runtime service.
 * @returns An array of DropDownListBoxEntry for R interpreters.
 */
export const getRInterpreterEntries = (
	runtimeStartupService: IRuntimeStartupService,
	languageRuntimeService: ILanguageRuntimeService
) => {
	const languageId = LanguageIds.R;
	const preferredRuntime = runtimeStartupService.getPreferredRuntime(languageId);

	return getInterpreterDropdownItems(
		languageRuntimeService,
		languageId,
		preferredRuntime?.runtimeId
	);
};

export const getSelectedRInterpreterId = (
	existingSelection: string | undefined,
	runtimeStartupService: IRuntimeStartupService,
) => {
	return existingSelection || getPreferredRuntimeId(runtimeStartupService, LanguageIds.R) || '';
};
