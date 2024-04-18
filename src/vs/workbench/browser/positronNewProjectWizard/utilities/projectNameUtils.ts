/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { IPathService } from 'vs/workbench/services/path/common/pathService';

/**
 * Determines if the specified folder is an existing directory.
 * @param folder The folder to check.
 * @param parentFolder The parent folder of the folder to check.
 * @param pathService The path service.
 * @param fileService The file service.
 * @returns A promise that resolves to true if the folder is an existing directory; otherwise, false.
 */
export const isExistingDirectory = async (
	folder: string,
	parentFolder: string,
	pathService: IPathService,
	fileService: IFileService
) => {
	const folderPath = URI.file((await pathService.path).join(parentFolder, folder));
	return await fileService.exists(folderPath);
};
