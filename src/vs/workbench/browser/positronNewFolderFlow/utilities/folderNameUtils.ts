/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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

/**
 * The maximum number of suffixed folder names to try in getUniqueFolderName.
 */
const MAX_UNIQUE_FOLDER_NAME_ATTEMPTS = 1000;

/**
 * Gets a folder name that does not exist in the parent folder. If the base name exists, appends
 * -2, -3, and so on until a name that does not exist is found.
 * @param baseName The preferred folder name.
 * @param parentFolder The parent folder.
 * @param fileService The file service.
 * @returns A promise that resolves to the unique folder name, or the base name if no unique name
 * was found.
 */
export const getUniqueFolderName = async (
	baseName: string,
	parentFolder: URI,
	fileService: IFileService
) => {
	if (!await fileService.exists(URI.joinPath(parentFolder, baseName))) {
		return baseName;
	}

	for (let i = 2; i <= MAX_UNIQUE_FOLDER_NAME_ATTEMPTS; i++) {
		const candidate = `${baseName}-${i}`;
		if (!await fileService.exists(URI.joinPath(parentFolder, candidate))) {
			return candidate;
		}
	}

	// No unique name was found, so fall back to the base name and let validation report it.
	return baseName;
};
