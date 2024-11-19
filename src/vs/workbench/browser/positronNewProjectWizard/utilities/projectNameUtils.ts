/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { WizardFormattedTextType } from '../components/wizardFormattedText.js';
import { IPathService } from '../../../services/path/common/pathService.js';

/**
 * Checks the project name to ensure it is valid.
 * @param projectName The project name to check.
 * @param parentFolder The parent folder of the project.
 * @param pathService The path service.
 * @param fileService The file service.
 * @returns A promise that resolves to a WizardFormattedTextItem if the project name is invalid; otherwise, undefined.
 */
export const checkProjectName = async (
	projectName: string,
	parentFolder: URI,
	pathService: IPathService,
	fileService: IFileService
) => {
	// The project name can't be empty.
	if (!projectName.trim()) {
		return {
			type: WizardFormattedTextType.Error,
			text: localize(
				'projectNameLocationSubStep.projectName.feedback.emptyProjectName',
				"Please enter a project name"
			),
		};
	}

	// TODO: Additional project name validation (i.e. unsupported characters, length, etc.)

	// The project directory can't already exist.
	const folderPath = parentFolder.with({ path: (await pathService.path).join(parentFolder.fsPath, projectName) });
	if (await fileService.exists(folderPath)) {
		return {
			type: WizardFormattedTextType.Error,
			text: localize(
				'projectNameLocationSubStep.projectName.feedback.existingDirectory',
				"The directory `{0}` already exists. Please enter a different project name.",
				projectName
			),
		};
	}

	// The project name is valid, so don't return any feedback.
	return undefined;
};
