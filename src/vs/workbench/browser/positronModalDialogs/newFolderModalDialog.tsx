/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './newFolderModalDialog.css';

// React.
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from '../../../nls.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IFileDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { IWorkbenchLayoutService } from '../../services/layout/browser/layoutService.js';
import { Checkbox } from '../positronComponents/positronModalDialog/components/checkbox.js';
import { VerticalStack } from '../positronComponents/positronModalDialog/components/verticalStack.js';
import { VerticalSpacer } from '../positronComponents/positronModalDialog/components/verticalSpacer.js';
import { PositronModalReactRenderer } from '../positronModalReactRenderer/positronModalReactRenderer.js';
import { LabeledTextInput } from '../positronComponents/positronModalDialog/components/labeledTextInput.js';
import { OKCancelModalDialog } from '../positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { LabeledFolderInput } from '../positronComponents/positronModalDialog/components/labeledFolderInput.js';
import { checkIfPathValid, isInputEmpty } from '../positronComponents/positronModalDialog/components/fileInputValidators.js';

/**
 * Shows the new folder modal dialog.
 * @param commandService The command service.
 * @param fileDialogService The file dialog service.
 * @param fileService The file service.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 */
export const showNewFolderModalDialog = async (
	commandService: ICommandService,
	fileDialogService: IFileDialogService,
	fileService: IFileService,
	keybindingService: IKeybindingService,
	layoutService: IWorkbenchLayoutService,
): Promise<void> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService,
		layoutService,
		container: layoutService.activeContainer
	});

	// Show the new folder modal dialog.
	renderer.render(
		<NewFolderModalDialog
			fileDialogService={fileDialogService}
			renderer={renderer}
			parentFolder={await fileDialogService.defaultFolderPath()}
			createFolder={async result => {
				// Create the folder path.
				const folderURI = URI.joinPath(result.parentFolder, result.folder);

				// Create the new folder, if it doesn't already exist.
				if (!(await fileService.exists(folderURI))) {
					await fileService.createFolder(folderURI);
				}

				// Open the folder.
				await commandService.executeCommand(
					'vscode.openFolder',
					folderURI,
					{
						forceNewWindow: result.newWindow,
						forceReuseWindow: !result.newWindow
					}
				);
			}}
		/>
	);
};

/**
 * NewFolderResult interface.
 */
interface NewFolderResult {
	readonly folder: string;
	readonly parentFolder: URI;
	readonly newWindow: boolean;
}

/**
 * NewFolderModalDialogProps interface.
 */
interface NewFolderModalDialogProps {
	fileDialogService: IFileDialogService;
	renderer: PositronModalReactRenderer;
	parentFolder: URI;
	createFolder: (result: NewFolderResult) => Promise<void>;
}

/**
 * NewFolderModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
const NewFolderModalDialog = (props: NewFolderModalDialogProps) => {
	// Reference hooks.
	const folderNameRef = useRef<HTMLInputElement>(undefined!);

	// State hooks.
	const [result, setResult] = useState<NewFolderResult>({
		folder: '',
		parentFolder: props.parentFolder,
		newWindow: false
	});

	// The browse handler.
	const browseHandler = async () => {
		// Show the open dialog.
		const uri = await props.fileDialogService.showOpenDialog({
			defaultUri: result.parentFolder ? result.parentFolder : await props.fileDialogService.defaultFolderPath(),
			canSelectFiles: false,
			canSelectFolders: true
		});

		// If the user made a selection, set the parent directory.
		if (uri?.length) {
			setResult({ ...result, parentFolder: uri[0] });
			folderNameRef.current.focus();
		}
	};

	// Render.
	return (
		<OKCancelModalDialog
			renderer={props.renderer}
			width={400}
			height={300}
			title={(() => localize('positronNewFolderModalDialogTitle', "New Folder"))()}
			catchErrors
			onAccept={async () => {
				if (isInputEmpty(result.folder)) {
					throw new Error(localize('positron.folderNameNotProvided', "A folder name was not provided."));
				}
				await props.createFolder(result);
				props.renderer.dispose();
			}}
			onCancel={() => props.renderer.dispose()}>
			<VerticalStack>
				<LabeledTextInput
					ref={folderNameRef}
					label={(() => localize('positron.folderName', "Folder name"))()}
					autoFocus
					value={result.folder}
					onChange={e => setResult({ ...result, folder: e.target.value })}
					validator={(x: string | number) => checkIfPathValid(x, { parentPath: result.parentFolder.path })}
				/>
				<LabeledFolderInput
					label={(() => localize(
						'positron.createFolderAsSubfolderOf',
						"Create folder as subfolder of"
					))()}
					value={result.parentFolder.fsPath}
					onBrowse={browseHandler}
					onChange={e => setResult({ ...result, parentFolder: result.parentFolder.with({ path: e.target.value }) })}
				/>
			</VerticalStack>
			<VerticalSpacer>
				<Checkbox
					label={(() => localize(
						'positron.openInNewWindow',
						"Open in a new window"
					))()}
					onChanged={checked => setResult({ ...result, newWindow: checked })}
				/>
			</VerticalSpacer>
		</OKCancelModalDialog>
	);
};
