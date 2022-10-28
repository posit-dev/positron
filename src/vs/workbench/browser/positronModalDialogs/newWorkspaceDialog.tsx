/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';

export interface NewWorkspaceDialogData {
	directory: string;
	parentDirectory: string;
	newWindow: boolean;
}

export interface NewWorkspaceDialogContext {
	fileDialogs: IFileDialogService;
}

export async function defaultParentDirectory(fileDialogs: IFileDialogService) {
	const defaultFolderUri = await fileDialogs.defaultFolderPath();
	return defaultFolderUri.fsPath;
}

export async function browseForParentDirectory(context: NewWorkspaceDialogContext, defaultDirectory?: string) {
	const uri = await context.fileDialogs.showOpenDialog({
		defaultUri: defaultDirectory ? URI.file(defaultDirectory) : undefined,
		canSelectFiles: false,
		canSelectFolders: true
	});
	return uri?.length ? uri[0].fsPath : undefined;
}
