/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './newFolderModalDialog.css';

// React.
import React, { useRef, useState } from 'react';

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
import { ILabelService } from '../../../platform/label/common/label.js';
import { IPathService } from '../../services/path/common/pathService.js';
import { combineLabelWithPathUri, pathUriToLabel } from '../utils/path.js';

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
	labelService: ILabelService,
	layoutService: IWorkbenchLayoutService,
	pathService: IPathService,
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
			fileDialogService={fileDialogService}
			labelService={labelService}
			parentFolder={await fileDialogService.defaultFolderPath()}
			pathService={pathService}
			renderer={renderer}
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
	labelService: ILabelService;
	pathService: IPathService;
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
	const [parentFolderLabel, setParentFolderLabel] = useState(
		() => pathUriToLabel(props.parentFolder, props.labelService)
	);
	const [result, setResult] = useState<NewFolderResult>({
		folder: '',
		parentFolder: props.parentFolder,
		newWindow: false
	});

	// The browse handler.
	const browseHandler = async () => {
		// Construct the parent folder URI.
		const parentFolderUri = await combineLabelWithPathUri(
			parentFolderLabel,
			props.parentFolder,
			props.pathService
		);

		// Show the open dialog.
		const uri = await props.fileDialogService.showOpenDialog({
			defaultUri: parentFolderUri,
			canSelectFiles: false,
			canSelectFolders: true
		});

		// If the user made a selection, set the parent directory.
		if (uri?.length) {
			const pathLabel = pathUriToLabel(uri[0], props.labelService);
			setParentFolderLabel(pathLabel);
			setResult({ ...result, parentFolder: uri[0] });
			folderNameRef.current.focus();
		}
	};

	// Update the parent folder.
	const onChangeParentFolder = async (folder: string) => {
		setParentFolderLabel(folder);
		const parentFolderUri = await combineLabelWithPathUri(
			folder,
			props.parentFolder,
			props.pathService
		);
		setResult({ ...result, parentFolder: parentFolderUri });
	};

	// Render.
	return (
		<OKCancelModalDialog
			catchErrors
			height={300}
			renderer={props.renderer}
			title={(() => localize('positronNewFolderModalDialogTitle', "New Folder"))()}
			width={400}
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
					autoFocus
					label={(() => localize('positron.folderName', "Folder name"))()}
					validator={(x: string | number) => checkIfPathValid(x, { parentPath: result.parentFolder.path })}
					value={result.folder}
					onChange={e => setResult({ ...result, folder: e.target.value })}
				/>
				<LabeledFolderInput
					label={(() => localize(
						'positron.createFolderAsSubfolderOf',
						"Create folder as subfolder of"
					))()}
					value={parentFolderLabel}
					onBrowse={browseHandler}
					onChange={async (e) => onChangeParentFolder(e.target.value)}
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
