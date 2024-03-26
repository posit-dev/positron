/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
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
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { Checkbox } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/checkbox';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';
import { VerticalSpacer } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalSpacer';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { LabeledTextInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledTextInput';
import { OKCancelModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronOKCancelModalDialog';
import { LabeledFolderInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledFolderInput';

/**
 * Shows the new folder modal dialog.
 * @param commandService The command service.
 * @param fileDialogService The file dialog service.
 * @param fileService The file service.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 * @param pathService The path service.
 */
export const showNewFolderModalDialog = async (
	commandService: ICommandService,
	fileDialogService: IFileDialogService,
	fileService: IFileService,
	keybindingService: IKeybindingService,
	layoutService: IWorkbenchLayoutService,
	pathService: IPathService
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
			parentFolder={(await fileDialogService.defaultFolderPath()).fsPath}
			createFolder={async result => {
				// Create the folder path.
				const path = await pathService.path;
				const folderURI = URI.file(path.join(result.parentFolder, result.folder));

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
	readonly parentFolder: string;
	readonly newWindow: boolean;
}

/**
 * NewFolderModalDialogProps interface.
 */
interface NewFolderModalDialogProps {
	fileDialogService: IFileDialogService;
	renderer: PositronModalReactRenderer;
	parentFolder: string;
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
			defaultUri: result.parentFolder ? URI.file(result.parentFolder) : undefined,
			canSelectFiles: false,
			canSelectFolders: true
		});

		// If the user made a selection, set the parent directory.
		if (uri?.length) {
			setResult({ ...result, parentFolder: uri[0].fsPath });
			folderNameRef.current.focus();
		}
	};

	// Render.
	return (
		<OKCancelModalDialog
			renderer={props.renderer}
			width={400}
			height={300}
			title={localize('positronNewFolderModalDialogTitle', "New Folder")}
			onAccept={async () => {
				props.renderer.dispose();
				await props.createFolder(result);
			}}
			onCancel={() => props.renderer.dispose()}>
			<VerticalStack>
				<LabeledTextInput
					ref={folderNameRef}
					label={localize('positron.folderName', "Folder name")}
					autoFocus
					value={result.folder}
					onChange={e => setResult({ ...result, folder: e.target.value })}
				/>
				<LabeledFolderInput
					label={localize(
						'positron.createFolderAsSubfolderOf',
						"Create folder as subfolder of"
					)}
					value={result.parentFolder}
					onBrowse={browseHandler}
					onChange={e => setResult({ ...result, parentFolder: e.target.value })}
				/>
			</VerticalStack>
			<VerticalSpacer>
				<Checkbox
					label={localize('positron.openInNewWindow', "Open in a new window")}
					onChanged={checked => setResult({ ...result, newWindow: checked })}
				/>
			</VerticalSpacer>
		</OKCancelModalDialog>
	);
};
