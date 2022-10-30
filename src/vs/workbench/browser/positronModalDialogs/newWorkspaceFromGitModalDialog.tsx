/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { useRef, useState } from 'react';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { TextInput } from 'vs/workbench/browser/positronModalDialogs/components/textInput';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';
import { CheckBoxInput } from 'vs/workbench/browser/positronModalDialogs/components/checkBoxInput';
import { DirectoryInput } from 'vs/workbench/browser/positronModalDialogs/components/directoryInput';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';

/**
 * NewWorkspaceFromGitResult interface.
 */
export interface NewWorkspaceFromGitResult {
	repo: string;
	parentDirectory: string;
	newWindow: boolean;
}

/**
 * Shows the NewWorkspaceModalDialog..
 * @param accessor The services accessor.
 * @returns The component.
 */
export const showNewWorkspaceFromGitModalDialog = async (accessor: ServicesAccessor): Promise<NewWorkspaceFromGitResult | undefined> => {
	// Get the services we need for the dialog.
	const fileDialogs = accessor.get(IFileDialogService);
	const layoutService = accessor.get(IWorkbenchLayoutService);

	// Load data we need to present the dialog.
	const parentDirectory = (await fileDialogs.defaultFolderPath()).fsPath;

	// Return a promise that resolves when the dialog is done.
	return new Promise<NewWorkspaceFromGitResult | undefined>((resolve) => {
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(layoutService.container);

		// The new workspace from git modal dialog component.
		const NewWorkspaceFromGitModalDialog = () => {
			// Hooks.
			const [newWorkspaceResult, setNewWorkspaceResult] = useState<NewWorkspaceFromGitResult>({
				repo: '',
				parentDirectory,
				newWindow: false
			});
			const directoryNameRef = useRef<HTMLInputElement>(undefined!);

			// The accept handler.
			const acceptHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(newWorkspaceResult);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(undefined);
			};

			// The browse handler.
			const browseHandler = async () => {
				// Show the open dialog.
				const uri = await fileDialogs.showOpenDialog({
					defaultUri: newWorkspaceResult.parentDirectory ? URI.file(newWorkspaceResult.parentDirectory) : undefined,
					canSelectFiles: false,
					canSelectFolders: true
				});

				// If the user made a selection, set the parent directory.
				if (uri?.length) {
					setNewWorkspaceResult({ ...newWorkspaceResult, parentDirectory: uri[0].fsPath });
					directoryNameRef.current.focus();
				}
			};

			// Render.
			return (
				<OKCancelModalDialog width={400} height={300} title={localize('positronNewWorkspaceDialogTitle', "New Workspace from Git")} acceptHandler={acceptHandler} cancelHandler={cancelHandler}>
					<TextInput
						ref={directoryNameRef}
						autoFocus label='Repository URL'
						value={newWorkspaceResult.repo}
						onChange={e => setNewWorkspaceResult({ ...newWorkspaceResult, repo: e.target.value })}
					/>
					<DirectoryInput
						label='Create workspace as subdirectory of'
						value={newWorkspaceResult.parentDirectory}
						onBrowse={browseHandler}
						onChange={e => setNewWorkspaceResult({ ...newWorkspaceResult, parentDirectory: e.target.value })}
					/>
					<CheckBoxInput
						label='Open in a new window' checked={newWorkspaceResult.newWindow}
						onChange={e => setNewWorkspaceResult({ ...newWorkspaceResult, newWindow: e.target.checked })}
					/>
				</OKCancelModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<NewWorkspaceFromGitModalDialog />);
	});
};
