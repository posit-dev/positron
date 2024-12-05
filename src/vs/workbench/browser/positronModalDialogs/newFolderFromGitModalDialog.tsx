/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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
import { isInputEmpty } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/fileInputValidators';
import { ILabelService } from 'vs/platform/label/common/label';

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
	labelService: ILabelService,
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
			labelService={labelService}
			renderer={renderer}
			parentFolder={await fileDialogService.defaultFolderPath()}
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
							result.parentFolder.fsPath
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
	readonly parentFolder: URI;
	readonly newWindow: boolean;
}

/**
 * NewFolderFromGitModalDialogProps interface.
 */
interface NewFolderFromGitModalDialogProps {
	fileDialogService: IFileDialogService;
	labelService: ILabelService;
	renderer: PositronModalReactRenderer;
	parentFolder: URI;
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
			title={(() => localize(
				'positronNewFolderFromGitModalDialogTitle',
				"New Folder from Git"
			))()}
			catchErrors
			onAccept={async () => {
				if (isInputEmpty(result.repo)) {
					throw new Error(localize('positron.gitRepoNotProvided', "A git repository URL was not provided."));
				}
				await props.createFolder(result);
				props.renderer.dispose();
			}}
			onCancel={() => props.renderer.dispose()}
		>
			<VerticalStack>
				<LabeledTextInput
					ref={folderNameRef}
					value={result.repo}
					label={(() => localize(
						'positron.GitRepositoryURL',
						"Git repository URL"
					))()}
					autoFocus
					onChange={e => setResult({ ...result, repo: e.target.value })}
				/>
				<LabeledFolderInput
					label={(() => localize(
						'positron.createFolderAsSubfolderOf',
						"Create folder as subfolder of"
					))()}
					value={props.labelService.getUriLabel(result.parentFolder)}
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
					onChanged={checked => setResult({ ...result, newWindow: checked })} />
			</VerticalSpacer>
		</OKCancelModalDialog>
	);
};
