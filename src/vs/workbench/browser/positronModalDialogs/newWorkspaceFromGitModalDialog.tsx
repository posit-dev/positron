/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./newWorkspaceModalDialog';
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { Checkbox } from 'vs/base/browser/ui/positronModalDialog/components/checkbox';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { VerticalSpacer } from 'vs/base/browser/ui/positronModalDialog/components/verticalSpacer';
import { DirectoryInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledDirectoryInput';
import { LabeledTextInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledTextInput';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';

/**
 * NewWorkspaceFromGitResult interface.
 */
export interface NewWorkspaceFromGitResult {
	readonly repo: string;
	readonly parentDirectory: string;
	readonly newWindow: boolean;
}

/**
 * Shows the NewWorkspaceFromGitModalDialog.
 * @param accessor The services accessor.
 * @returns A promise that resolves when the dialog is dismissed.
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
			const [newWorkspaceFromGitResult, setNewWorkspaceFromGitResult] = useState<NewWorkspaceFromGitResult>({
				repo: '',
				parentDirectory,
				newWindow: false
			});
			const directoryNameRef = useRef<HTMLInputElement>(undefined!);

			// The accept handler.
			const acceptHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(newWorkspaceFromGitResult);
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
					defaultUri: newWorkspaceFromGitResult.parentDirectory ? URI.file(newWorkspaceFromGitResult.parentDirectory) : undefined,
					canSelectFiles: false,
					canSelectFolders: true
				});

				// If the user made a selection, set the parent directory.
				if (uri?.length) {
					setNewWorkspaceFromGitResult({ ...newWorkspaceFromGitResult, parentDirectory: uri[0].fsPath });
					directoryNameRef.current.focus();
				}
			};

			// Render.
			return (
				<OKCancelModalDialog width={400} height={300} title={localize('positronNewWorkspaceFromGitModalDialogTitle', "New Workspace from Git")} accept={acceptHandler} cancel={cancelHandler}>
					<VerticalStack>
						<LabeledTextInput
							ref={directoryNameRef}
							value={newWorkspaceFromGitResult.repo}
							label='Repository URL'
							autoFocus
							onChange={e => setNewWorkspaceFromGitResult({ ...newWorkspaceFromGitResult, repo: e.target.value })}
						/>
						<DirectoryInput
							label='Create workspace as subdirectory of'
							value={newWorkspaceFromGitResult.parentDirectory}
							onBrowse={browseHandler}
							onChange={e => setNewWorkspaceFromGitResult({ ...newWorkspaceFromGitResult, parentDirectory: e.target.value })}
						/>
					</VerticalStack>
					<VerticalSpacer>
						<Checkbox label='Open in a new window' onChanged={checked => setNewWorkspaceFromGitResult({ ...newWorkspaceFromGitResult, newWindow: checked })} />
					</VerticalSpacer>
				</OKCancelModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<NewWorkspaceFromGitModalDialog />);
	});
};
