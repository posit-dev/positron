/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './newFolderFromGitModalDialog.css';

// React.
import { useCallback, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { URI } from '../../../base/common/uri.js';
import { combineLabelWithPathUri, pathUriToLabel } from '../utils/path.js';
import { folderNameFromGitRepoUrl } from './newFolderFromGitFolderName.js';
import { Checkbox } from '../positronComponents/positronModalDialog/components/checkbox.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';
import { VerticalStack } from '../positronComponents/positronModalDialog/components/verticalStack.js';
import { usePositronReactServicesContext } from '../../../base/browser/positronReactRendererContext.js';
import { VerticalSpacer } from '../positronComponents/positronModalDialog/components/verticalSpacer.js';
import { checkIfPathValid, isInputEmpty } from '../positronComponents/positronModalDialog/components/fileInputValidators.js';
import { LabeledTextInput } from '../positronComponents/positronModalDialog/components/labeledTextInput.js';
import { OKCancelModalDialog } from '../positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { LabeledFolderInput } from '../positronComponents/positronModalDialog/components/labeledFolderInput.js';

/**
 * NewFolderFromGitResult interface.
 */
interface NewFolderFromGitResult {
	readonly repo: string;
	readonly folderName: string;
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
	const repoUrlRef = useRef<HTMLInputElement>(undefined!);

	// State hooks.
	const [parentFolderLabel, setParentFolderLabel] = useState(
		() => pathUriToLabel(props.parentFolder, services.labelService)
	);
	const [result, setResult] = useState<NewFolderFromGitResult>({
		repo: '',
		folderName: '',
		parentFolder: props.parentFolder,
		newWindow: false
	});
	// Whether the folder name is the user's to maintain. Until they type one, it follows the
	// repository URL; once they do, their name stands even as the URL keeps changing.
	const [folderNameEdited, setFolderNameEdited] = useState(false);

	// Validate the folder name against the parent folder it will be created in.
	const validateFolderName = useCallback(async (name: string): Promise<string | undefined> => {
		if (isInputEmpty(name)) {
			return localize('positron.folderNameRequired', "A folder name is required.");
		}

		// A separator would clone into a subfolder of the folder the user picked, which is not what
		// a name field offers to do. checkIfPathValid validates only the last segment, so this is
		// checked first.
		if (/[\\/]/.test(name)) {
			return localize(
				'positron.folderNameHasSeparator',
				"A folder name cannot contain a path separator."
			);
		}

		const invalidNameError = checkIfPathValid(name, { parentPath: parentFolderLabel });
		if (invalidNameError) {
			return invalidNameError;
		}

		// Cloning into a folder that already exists fails in Git with a message about a non-empty
		// directory, well after the dialog is gone, so the conflict is reported here instead.
		if (await services.fileService.exists(URI.joinPath(result.parentFolder, name))) {
			return localize(
				'positron.folderAlreadyExists',
				"A folder named '{0}' already exists.",
				name
			);
		}

		return undefined;
	}, [parentFolderLabel, result.parentFolder, services.fileService]);

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
			setResult(prevResult => ({ ...prevResult, parentFolder: uri[0] }));
			repoUrlRef.current.focus();
		}
	};

	// Update the repository URL, and with it the folder name the user has not claimed.
	const onChangeRepo = (repo: string) => {
		setResult(prevResult => ({
			...prevResult,
			repo,
			folderName: folderNameEdited
				? prevResult.folderName
				: folderNameFromGitRepoUrl(repo)
		}));
	};

	// Update the folder name.
	const onChangeFolderName = (folderName: string) => {
		// Clearing the field puts the name back under the URL's control. The field is left empty
		// rather than refilled, so backspacing through a name to retype it does not fight the user
		// by restoring the default mid-edit.
		setFolderNameEdited(!isInputEmpty(folderName));
		setResult(prevResult => ({ ...prevResult, folderName }));
	};

	// Update the parent folder.
	const onChangeParentFolder = async (folder: string) => {
		setParentFolderLabel(folder);
		const parentFolderUri = await combineLabelWithPathUri(
			folder,
			props.parentFolder,
			services.pathService
		);
		setResult(prevResult => ({ ...prevResult, parentFolder: parentFolderUri }));
	};

	// Render.
	return (
		<OKCancelModalDialog
			catchErrors
			height={360}
			renderer={props.renderer}
			title={localize(
				'positronNewFolderFromGitModalDialogTitle',
				"New Folder from Git"
			)}
			width={400}
			onAccept={async () => {
				if (isInputEmpty(result.repo)) {
					throw new Error(localize('positron.gitRepoNotProvided', "A git repository URL was not provided."));
				}
				// The folder name is validated on submission, rather than as the user types
				// so an empty field, a collision, or a bad name is reported with all other
				// errors in the dialog instead of as an error under the field.
				const error = await validateFolderName(result.folderName);
				if (error) {
					throw new Error(error);
				}
				// Dispose dialog immediately, then start cloning
				props.renderer.dispose();
				await props.createFolder(result);
			}}
			onCancel={() => props.renderer.dispose()}
		>
			<VerticalStack>
				<LabeledTextInput
					ref={repoUrlRef}
					autoFocus
					label={localize(
						'positron.GitRepositoryURL',
						"Git repository URL"
					)}
					value={result.repo}
					onChange={e => onChangeRepo(e.target.value)}
				/>
				<LabeledTextInput
					label={localize(
						'positron.folderName',
						"Folder name"
					)}
					value={result.folderName}
					onChange={e => onChangeFolderName(e.target.value)}
				/>
				<LabeledFolderInput
					label={localize(
						'positron.createFolderAsSubfolderOf',
						"Create folder as subfolder of"
					)}
					value={parentFolderLabel}
					onBrowse={browseHandler}
					onChange={e => onChangeParentFolder(e.target.value)}
				/>
			</VerticalStack>
			<VerticalSpacer>
				<Checkbox
					label={localize(
						'positron.openInNewWindow',
						"Open in a new window"
					)}
					onChanged={checked => setResult(prevResult => ({ ...prevResult, newWindow: checked }))} />
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
							parentFolder,
							// Naming the target explicitly is what lets the clone land somewhere
							// other than the repository's own name. Without it the Git extension
							// derives the name from the URL and silently suffixes '-1', '-2' on a
							// collision; the dialog has already reported any collision by now.
							{ targetName: result.folderName }
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
