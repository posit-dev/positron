/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { FlowFormattedTextType } from '../components/flowFormattedText.js';

/**
 * The maximum length of a folder path, which is the full path when joining a parent folder with
 * the folder name.
 */
const MAX_LENGTH_FOLDER_PATH = 255;

/**
 * Calculates the maximum length of a folder name based on the maximum length of a folder path and
 * the length of the parent folder path.
 * @param parentFolderLength The length of the parent folder path string.
 * @returns The maximum length of a folder name.
 */
export const getMaxFolderPathLength = (parentFolderLength: number) => MAX_LENGTH_FOLDER_PATH + 1 - parentFolderLength;

/**
 * Checks the folder name to ensure it is valid.
 * @param folderName The folder name to check.
 * @param parentFolder The parent folder.
 * @param pathService The path service.
 * @param fileService The file service.
 * @returns A promise that resolves to a FlowFormattedTextItem if the folder name is invalid; otherwise, undefined.
 */
export const checkFolderName = async (
	folderName: string,
	parentFolder: URI,
	fileService: IFileService
) => {
	// The folder name can't be empty.
	if (!folderName.trim()) {
		return {
			type: FlowFormattedTextType.Error,
			text: localize(
				'folderNameLocationSubStep.folderName.feedback.emptyFolderName',
				"Please enter a folder name."
			),
		};
	}

	// TODO: Additional folder name validation (i.e. unsupported characters, length, etc.)

	// The folder can't already exist.
	const folderPath = URI.joinPath(parentFolder, folderName);
	if (await fileService.exists(folderPath)) {
		return {
			type: FlowFormattedTextType.Error,
			text: localize(
				'folderNameLocationSubStep.folderName.feedback.existingFolder',
				"A folder named '{0}' already exists.",
				folderName
			),
		};
	}

	// The folder name is valid, so don't return any feedback.
	return undefined;
};
