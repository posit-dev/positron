/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./newFolderModalDialog';

// React.
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { Checkbox } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/checkbox';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';
import { VerticalSpacer } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalSpacer';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { LabeledTextInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledTextInput';
import { OKCancelModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronOKCancelModalDialog';
import { LabeledFolderInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledFolderInput';
import { checkIfPathValid, isInputEmpty } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/fileInputValidators';
import { ILabelService } from 'vs/platform/label/common/label';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { combineLabelWithPathUri, pathUriToLabel } from 'vs/workbench/browser/utils/path';

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
			fileDialogService={fileDialogService}
			labelService={labelService}
			pathService={pathService}
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
