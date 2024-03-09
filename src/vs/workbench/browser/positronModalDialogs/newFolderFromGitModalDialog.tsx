/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./newFolderFromGitModalDialog';
import * as React from 'react';
import { useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { Checkbox } from 'vs/base/browser/ui/positronModalDialog/components/checkbox';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { VerticalSpacer } from 'vs/base/browser/ui/positronModalDialog/components/verticalSpacer';
import { LabeledTextInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledTextInput';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { LabeledFolderInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledFolderInput';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';

/**
 * NewFolderFromGitResult interface.
 */
export interface NewFolderFromGitResult {
	readonly repo: string;
	readonly parentFolder: string;
	readonly newWindow: boolean;
}

/**
 * Shows the NewFolderFromGitModalDialog.
 * @param accessor The services accessor.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const showNewFolderFromGitModalDialog = async (accessor: ServicesAccessor): Promise<NewFolderFromGitResult | undefined> => {
	// Get the services we need for the dialog.
	const fileDialogs = accessor.get(IFileDialogService);
	const layoutService = accessor.get(IWorkbenchLayoutService);

	// Load data we need to present the dialog.
	const parentFolder = (await fileDialogs.defaultFolderPath()).fsPath;

	// Return a promise that resolves when the dialog is done.
	return new Promise<NewFolderFromGitResult | undefined>((resolve) => {
		// Create the modal React renderer.
		const positronModalReactRenderer =
			new PositronModalReactRenderer(layoutService.mainContainer);

		// The new folder from git modal dialog component.
		const NewFolderFromGitModalDialog = () => {
			// Hooks.
			const [newFolderFromGitResult, setNewFolderFromGitResult, newFolderFromGitResultRef] = useStateRef<NewFolderFromGitResult>({
				repo: '',
				parentFolder,
				newWindow: false
			});
			const folderNameRef = useRef<HTMLInputElement>(undefined!);

			// The accept handler.
			const acceptHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(newFolderFromGitResultRef.current);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(undefined);
			};

			// The browse handler.
			const browseHandler = async () => {
				// Show the open dialog.
				const uri = await fileDialogs.showOpenDialog({
					defaultUri: newFolderFromGitResult.parentFolder ? URI.file(newFolderFromGitResult.parentFolder) : undefined,
					canSelectFiles: false,
					canSelectFolders: true
				});

				// If the user made a selection, set the parent directory.
				if (uri?.length) {
					setNewFolderFromGitResult({ ...newFolderFromGitResult, parentFolder: uri[0].fsPath });
					folderNameRef.current.focus();
				}
			};

			// Render.
			return (
				<OKCancelModalDialog renderer={positronModalReactRenderer} width={400} height={300} title={localize('positronNewFolderFromGitModalDialogTitle', "New Folder from Git")} accept={acceptHandler} cancel={cancelHandler}>
					<VerticalStack>
						<LabeledTextInput
							ref={folderNameRef}
							value={newFolderFromGitResult.repo}
							label='Git repository URL'
							autoFocus
							onChange={e => setNewFolderFromGitResult({ ...newFolderFromGitResult, repo: e.target.value })}
						/>
						<LabeledFolderInput
							label='Create folder as subfolder of'
							value={newFolderFromGitResult.parentFolder}
							onBrowse={browseHandler}
							onChange={e => setNewFolderFromGitResult({ ...newFolderFromGitResult, parentFolder: e.target.value })}
						/>
					</VerticalStack>
					<VerticalSpacer>
						<Checkbox label='Open in a new window' onChanged={checked => setNewFolderFromGitResult({ ...newFolderFromGitResult, newWindow: checked })} />
					</VerticalSpacer>
				</OKCancelModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalReactRenderer.render(<NewFolderFromGitModalDialog />);
	});
};
