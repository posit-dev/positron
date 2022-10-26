/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { FC, useRef, useState } from 'react';
import { localize } from 'vs/nls';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { showPositronModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { TextInput } from 'vs/workbench/browser/positronModalDialogs/components/textInput';
import { CheckBoxInput } from 'vs/workbench/browser/positronModalDialogs/components/checkBoxInput';
import { DirectoryInput } from 'vs/workbench/browser/positronModalDialogs/components/directoryInput';
import { browseForParentDirectory, defaultParentDirectory, NewWorkspaceDialogContext } from 'vs/workbench/browser/positronModalDialogs/newWorkspaceDialog';

export interface NewWorkspaceFromGitDialogData {
	repo: string;
	parentDirectory: string;
	newWindow: boolean;
}

export async function showNewWorkspaceFromGitDialog(accessor: ServicesAccessor): Promise<NewWorkspaceFromGitDialogData | undefined> {

	// get services
	const layoutService = accessor.get(ILayoutService);
	const fileDialogs = accessor.get(IFileDialogService);

	// default input
	const input: NewWorkspaceFromGitDialogData = {
		repo: '',
		parentDirectory: await defaultParentDirectory(fileDialogs),
		newWindow: false
	};

	return showPositronModalDialog<NewWorkspaceFromGitDialogData, NewWorkspaceDialogContext>({
		input,
		Editor: NewWorkspaceFromGitDialogEditor,
		title: localize('positronNewWorkspaceDialogTitle', "New Workspace from Git"),
		width: 400,
		height: 300,
		container: layoutService.container,
		context: { fileDialogs }
	});
}


interface NewWorkspaceFromGitDialogProps {
	input: NewWorkspaceFromGitDialogData;
	context: NewWorkspaceDialogContext;
	onAccept: (f: () => NewWorkspaceFromGitDialogData) => void;
}

const NewWorkspaceFromGitDialogEditor: FC<NewWorkspaceFromGitDialogProps> = (props) => {

	// dialog state (report on accept)
	const [state, setState] = useState<NewWorkspaceFromGitDialogData>(props.input);
	props.onAccept(() => state);

	// save ref to input for focus after dialog
	const inputRef = useRef<HTMLInputElement>(null);

	// browse for parent directory
	const browseForParent = async () => {
		const parentDirectory = await browseForParentDirectory(props.context, state.parentDirectory);
		if (parentDirectory) {
			setState({ ...state, parentDirectory });
			if (inputRef.current) {
				inputRef.current.focus();
			}
		}
	};

	return (
		<>
			<TextInput
				ref={inputRef}
				autoFocus label='Repository URL' value={state.repo}
				onChange={e => setState({ ...state, repo: e.target.value })}
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

