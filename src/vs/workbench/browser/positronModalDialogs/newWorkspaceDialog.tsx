/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { FC, useState } from 'react';
import { localize } from 'vs/nls';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { showPositronModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IPath } from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import { TextInput } from 'vs/workbench/browser/positronModalDialogs/components/textInput';
import { CheckBoxInput } from 'vs/workbench/browser/positronModalDialogs/components/checkBoxInput';
import { DirectoryInput } from 'vs/workbench/browser/positronModalDialogs/components/directoryInput';

export interface NewWorkspaceDialogData {
	directory: string;
	parentDirectory: string;
	newWindow: boolean;
}

export interface NewWorkspaceDialogContext {
	fileDialogs: IFileDialogService;
}

export async function showNewWorkspaceDialog(accessor: ServicesAccessor): Promise<NewWorkspaceDialogData | undefined> {

	// get services
	const layoutService = accessor.get(ILayoutService);
	const fileDialogs = accessor.get(IFileDialogService);
	const pathService = accessor.get(IPathService);

	// default input
	const input: NewWorkspaceDialogData = {
		directory: '',
		parentDirectory: await defaultParentDirectory(fileDialogs, await pathService.path),
		newWindow: false
	};

	return showPositronModalDialog<NewWorkspaceDialogData, NewWorkspaceDialogContext>({
		input,
		Editor: NewWorkspaceDialogEditor,
		title: localize('positronNewWorkspaceDialogTitle', "New Workspace"),
		width: 400,
		height: 300,
		container: layoutService.container,
		context: { fileDialogs }
	});
}

export async function defaultParentDirectory(fileDialogs: IFileDialogService, path: IPath) {
	const defaultWorkspaceUri = await fileDialogs.defaultWorkspacePath();
	return path.dirname(defaultWorkspaceUri.fsPath);
}

export async function browseForParentDirectory(context: NewWorkspaceDialogContext, defaultDirectory?: string) {
	const uri = await context.fileDialogs.showOpenDialog({
		defaultUri: defaultDirectory ? URI.file(defaultDirectory) : undefined,
		canSelectFiles: false,
		canSelectFolders: true
	});
	return uri?.length ? uri[0].fsPath : undefined;
}


interface NewWorkspaceDialogProps {
	input: NewWorkspaceDialogData;
	context: NewWorkspaceDialogContext;
	onAccept: (f: () => NewWorkspaceDialogData) => void;
}

const NewWorkspaceDialogEditor: FC<NewWorkspaceDialogProps> = (props) => {

	// dialog state (report on accept)
	const [state, setState] = useState<NewWorkspaceDialogData>(props.input);
	props.onAccept(() => state);

	// browse for parent directory
	const browseForParent = async () => {
		const parentDirectory = await browseForParentDirectory(props.context, state.parentDirectory);
		if (parentDirectory) {
			setState({ ...state, parentDirectory });
		}
	};

	return (
		<>
			<TextInput
				autoFocus label='Directory name' value={state.directory}
				onChange={e => setState({ ...state, directory: e.target.value })}
			/>
			<DirectoryInput
				label='Create workspace as subdirectory of'
				value={state.parentDirectory}
				onBrowse={browseForParent}
				onChange={e => setState({ ...state, parentDirectory: e.target.value })}
			/>
			<CheckBoxInput
				label='Open in a new window' checked={state.newWindow}
				onChange={e => setState({ ...state, newWindow: e.target.checked })}
			/>
		</>
	);
};
