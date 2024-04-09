/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { NewProjectType } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';

/**
 * NewProjectTypeOptions interface.
 */
interface NewProjectTypeOptions {
	name: NewProjectType; // TODO: maybe remove this since it is redundant with the key in the map
	runtimeLanguageId: string;
	iconPath: string;
}

/**
 * NewProjectTypeToLanguageIdMap is a mapping of NewProjectType to a language id.
 * The language id is used to lookup runtime information via the IRuntimeStartupService.
 */
export const NewProjectTypeToLanguageIdMap: Readonly<Record<NewProjectType, NewProjectTypeOptions>> = {
	[NewProjectType.PythonProject]: {
		name: NewProjectType.PythonProject,
		runtimeLanguageId: 'python',
		iconPath: ''
	},
	[NewProjectType.RProject]: {
		name: NewProjectType.RProject,
		runtimeLanguageId: 'r',
		iconPath: ''
	},
	[NewProjectType.JupyterNotebook]: {
		name: NewProjectType.JupyterNotebook,
		runtimeLanguageId: 'python',
		iconPath: ''
	}
};
