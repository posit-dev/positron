/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './newFolderFromGitModalDialog.css';

// React.
import React, { useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { URI } from '../../../base/common/uri.js';
import { combineLabelWithPathUri, pathUriToLabel } from '../utils/path.js';
import { Checkbox } from '../positronComponents/positronModalDialog/components/checkbox.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';
import { VerticalStack } from '../positronComponents/positronModalDialog/components/verticalStack.js';
import { usePositronReactServicesContext } from '../../../base/browser/positronReactRendererContext.js';
import { VerticalSpacer } from '../positronComponents/positronModalDialog/components/verticalSpacer.js';
import { isInputEmpty } from '../positronComponents/positronModalDialog/components/fileInputValidators.js';
import { LabeledTextInput } from '../positronComponents/positronModalDialog/components/labeledTextInput.js';
import { OKCancelModalDialog } from '../positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { LabeledFolderInput } from '../positronComponents/positronModalDialog/components/labeledFolderInput.js';

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
	const services = usePositronReactServicesContext();

	// Reference hooks.
	const folderNameRef = useRef<HTMLInputElement>(undefined!);

	// State hooks.
	const [parentFolderLabel, setParentFolderLabel] = useState(
		() => pathUriToLabel(props.parentFolder, services.labelService)
	);
	const [result, setResult] = useState<NewFolderFromGitResult>({
		repo: '',
		parentFolder: props.parentFolder,
		newWindow: false
	});

	// The browse handler.
	const browseHandler = async () => {
		// Construct the parent folder URI.
		const parentFolderUri = await combineLabelWithPathUri(
			parentFolderLabel,
			props.parentFolder,
			services.pathService
		);

		// Show the open dialog.
		const uri = await services.fileDialogService.showOpenDialog({
			defaultUri: parentFolderUri,
			canSelectFiles: false,
			canSelectFolders: true
		});

		// If the user made a selection, set the parent directory.
		if (uri?.length) {
			const pathLabel = pathUriToLabel(uri[0], services.labelService);
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
			services.pathService
		);
		setResult({ ...result, parentFolder: parentFolderUri });
	};

	// Render.
	return (
		<OKCancelModalDialog
			catchErrors
			height={300}
			renderer={props.renderer}
			title={(() => localize(
				'positronNewFolderFromGitModalDialogTitle',
				"New Folder from Git"
			))()}
			width={400}
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
					autoFocus
					label={(() => localize(
						'positron.GitRepositoryURL',
						"Git repository URL"
					))()}
					value={result.repo}
					onChange={e => setResult({ ...result, repo: e.target.value })}
				/>
				<LabeledFolderInput
					label={(() => localize(
						'positron.createFolderAsSubfolderOf',
						"Create folder as subfolder of"
					))()}
					value={parentFolderLabel}
					onBrowse={browseHandler}
					onChange={e => onChangeParentFolder(e.target.value)}
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

/**
 * Shows the new folder from Git modal dialog.
 */
export const showNewFolderFromGitModalDialog = async (): Promise<void> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	// Show the new folder from git modal dialog.
	renderer.render(
		<NewFolderFromGitModalDialog
			createFolder={async result => {
				if (result.repo) {
					// temporarily set openAfterClone to facilitate result.newWindow then set it
					// back afterwards
					const kGitOpenAfterClone = 'git.openAfterClone';
					const prevOpenAfterClone = renderer.services.configurationService.getValue(kGitOpenAfterClone);
					renderer.services.configurationService.updateValue(
						kGitOpenAfterClone,
						result.newWindow ? 'alwaysNewWindow' : 'always'
					);
					// The Git clone command works with a path string instead of a URI. We need to
					// convert the folder URI to an OS-aware path string using the label service.
					const parentFolder = renderer.services.labelService.getUriLabel(
						result.parentFolder,
						{ noPrefix: true }
					);
					try {
						await renderer.services.commandService.executeCommand(
							'git.clone',
							result.repo,
							parentFolder
						);
					} finally {
						renderer.services.configurationService.updateValue(kGitOpenAfterClone, prevOpenAfterClone);
					}
				}
			}}
			parentFolder={await renderer.services.fileDialogService.defaultFolderPath()}
			renderer={renderer}
		/>
	);
};
