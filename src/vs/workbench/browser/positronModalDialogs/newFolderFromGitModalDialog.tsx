/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./newFolderFromGitModalDialog';

// React.
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { Checkbox } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/checkbox';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';
import { VerticalSpacer } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalSpacer';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { LabeledTextInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledTextInput';
import { OKCancelModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronOKCancelModalDialog';
import { LabeledFolderInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledFolderInput';

/**
 * Shows the new folder from Git modal dialog.
 * @param commandService The command service.
 * @param configService The config service.
 * @param fileDialogService The file dialog service.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 */
export const showNewFolderFromGitModalDialog = async (
	commandService: ICommandService,
	configurationService: IConfigurationService,
	fileDialogService: IFileDialogService,
	keybindingService: IKeybindingService,
	layoutService: IWorkbenchLayoutService,
): Promise<void> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService,
		layoutService,
		container: layoutService.activeContainer
	});

	// Show the new folder from git modal dialog.
	renderer.render(
		<NewFolderFromGitModalDialog
			fileDialogService={fileDialogService}
			renderer={renderer}
			parentFolder={(await fileDialogService.defaultFolderPath()).fsPath}
			createFolder={async result => {
				if (result.repo) {
					// temporarily set openAfterClone to facilitate result.newWindow then set it
					// back afterwards
					const kGitOpenAfterClone = 'git.openAfterClone';
					const prevOpenAfterClone = configurationService.getValue(kGitOpenAfterClone);
					configurationService.updateValue(
						kGitOpenAfterClone,
						result.newWindow ? 'alwaysNewWindow' : 'always'
					);
					try {
						await commandService.executeCommand(
							'git.clone',
							result.repo,
							result.parentFolder
						);
					} finally {
						configurationService.updateValue(kGitOpenAfterClone, prevOpenAfterClone);
					}
				}
			}}
		/>
	);
};

/**
 * NewFolderFromGitResult interface.
 */
interface NewFolderFromGitResult {
	readonly repo: string;
	readonly parentFolder: string;
	readonly newWindow: boolean;
}

/**
 * NewFolderFromGitModalDialogProps interface.
 */
interface NewFolderFromGitModalDialogProps {
	fileDialogService: IFileDialogService;
	renderer: PositronModalReactRenderer;
	parentFolder: string;
	createFolder: (result: NewFolderFromGitResult) => Promise<void>;
}

/**
 * NewFolderFromGitModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const NewFolderFromGitModalDialog = (props: NewFolderFromGitModalDialogProps) => {
	// Reference hooks.
	const folderNameRef = useRef<HTMLInputElement>(undefined!);

	// State hooks.
	const [result, setResult] = useState<NewFolderFromGitResult>({
		repo: '',
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
			title={localize('positronNewFolderFromGitModalDialogTitle', "New Folder from Git")}
			onAccept={async () => {
				props.renderer.dispose();
				await props.createFolder(result);
			}}
			onCancel={() => props.renderer.dispose()}
		>
			<VerticalStack>
				<LabeledTextInput
					ref={folderNameRef}
					value={result.repo}
					label={localize('positron.GitRepositoryURL', "Git repository URL")}
					autoFocus
					onChange={e => setResult({ ...result, repo: e.target.value })}
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
					onChanged={checked => setResult({ ...result, newWindow: checked })} />
			</VerticalSpacer>
		</OKCancelModalDialog>
	);
};
