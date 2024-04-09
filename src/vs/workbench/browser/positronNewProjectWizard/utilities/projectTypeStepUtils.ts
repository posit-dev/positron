/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ProjectTypeItem } from 'vs/workbench/browser/positronNewProjectWizard/components/projectType';
import { NewProjectType } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { NewProjectTypeToLanguageIdMap } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardProjectTypes';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

export const getProjectTypeItems = (languageRuntimeService: ILanguageRuntimeService) => {
	const projectTypeItems: ProjectTypeItem[] = [];
	const registeredRuntimes = languageRuntimeService.registeredRuntimes;

	for (const [projectType, options] of Object.entries(NewProjectTypeToLanguageIdMap)) {
		let icon = '';
		// Find the icon for the runtime language.
		for (const runtime of registeredRuntimes) {
			if (runtime.languageId === options.runtimeLanguageId && runtime.base64EncodedIconSvg) {
				icon = runtime.base64EncodedIconSvg;
				continue;
			}
		}
		console.log('project type options: ', options);
		projectTypeItems.push(
			new ProjectTypeItem({
				identifier: projectType as NewProjectType,
				title: projectType,
				icon
			})
		);
	}
	return projectTypeItems;
};
