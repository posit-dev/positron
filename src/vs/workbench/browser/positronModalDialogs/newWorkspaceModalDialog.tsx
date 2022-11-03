/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./newWorkspaceModalDialog';
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { DirectoryInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledDirectoryInput';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { LabeledTextInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledTextInput';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { Checkbox } from 'vs/base/browser/ui/positronModalDialog/components/checkbox';
import { VerticalSpacer } from 'vs/base/browser/ui/positronModalDialog/components/verticalSpacer';

/**
 * NewWorkspaceResult interface.
 */
export interface NewWorkspaceResult {
	directory: string;
	parentDirectory: string;
	newWindow: boolean;
}

/**
 * Shows the NewWorkspaceModalDialog..
 * @param accessor The services accessor.
 * @returns The component.
 */
export const showNewWorkspaceModalDialog = async (accessor: ServicesAccessor): Promise<NewWorkspaceResult | undefined> => {
	// Get the services we need for the dialog.
	const fileDialogs = accessor.get(IFileDialogService);
	const layoutService = accessor.get(IWorkbenchLayoutService);

	// Load data we need to present the dialog.
	const parentDirectory = (await fileDialogs.defaultFolderPath()).fsPath;

	// Return a promise that resolves when the dialog is done.
	return new Promise<NewWorkspaceResult | undefined>((resolve) => {
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(layoutService.container);

		// The new workspace modal dialog component.
		const NewWorkspaceModalDialog = () => {
			// Hooks.
			const [newWorkspaceResult, setNewWorkspaceResult] = useState<NewWorkspaceResult>({
				directory: '',
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
				<OKCancelModalDialog width={400} height={300} title={localize('positronNewWorkspaceDialogTitle', "New Workspace")} accept={acceptHandler} cancel={cancelHandler}>
					<VerticalStack>
						<LabeledTextInput
							ref={directoryNameRef}
							autoFocus label='Directory name'
							value={newWorkspaceResult.directory}
							onChange={e => setNewWorkspaceResult({ ...newWorkspaceResult, directory: e.target.value })}
						/>
						<DirectoryInput
							label='Create workspace as subdirectory of'
							value={newWorkspaceResult.parentDirectory}
							onBrowse={browseHandler}
							onChange={e => setNewWorkspaceResult({ ...newWorkspaceResult, parentDirectory: e.target.value })}
						/>
					</VerticalStack>
					<VerticalSpacer>
						<Checkbox id='open-in-new-window' label='Open in a new window' onChanged={checked => setNewWorkspaceResult({ ...newWorkspaceResult, newWindow: checked })} />
					</VerticalSpacer>
				</OKCancelModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<NewWorkspaceModalDialog />);
	});
};
