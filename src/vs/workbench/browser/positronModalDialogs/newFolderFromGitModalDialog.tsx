/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './newFolderFromGitModalDialog.css';

// React.
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { URI } from '../../../base/common/uri.js';
import { toErrorMessage } from '../../../base/common/errorMessage.js';
import { combineLabelWithPathUri, pathUriToLabel } from '../utils/path.js';
import { folderNameFromGitRepoUrl } from './newFolderFromGitFolderName.js';
import { checkGitStatus, getGitStatusNow, GitStatus } from './newFolderFromGitStatus.js';
import { CommandsRegistry } from '../../../platform/commands/common/commands.js';
import { Checkbox } from '../positronComponents/positronModalDialog/components/checkbox.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';
import { VerticalStack } from '../positronComponents/positronModalDialog/components/verticalStack.js';
import { usePositronReactServicesContext } from '../../../base/browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../base/browser/positronReactServices.js';
import { VerticalSpacer } from '../positronComponents/positronModalDialog/components/verticalSpacer.js';
import { checkIfPathValid, isInputEmpty } from '../positronComponents/positronModalDialog/components/fileInputValidators.js';
import { LabeledTextInput } from '../positronComponents/positronModalDialog/components/labeledTextInput.js';
import { OKCancelModalDialog } from '../positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { PositronDynamicModalDialog } from '../positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { OneButtonFooter } from '../positronComponents/positronDynamicModalDialog/components/oneButtonFooter.js';
import { TwoButtonFooter } from '../positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
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
	// Whether Git can clone. Known right away in the common case, so the form shows with no
	// checking state; otherwise checked once the Git extension has activated.
	const [gitStatus, setGitStatus] = useState<GitStatus | 'checking'>(
		() => getGitStatusNow(gitStatusServices(services)) ?? 'checking'
	);

	// Check the Git status when it was not known right away.
	useEffect(() => {
		if (gitStatus !== 'checking') {
			return;
		}
		let disposed = false;
		checkGitStatus(gitStatusServices(services)).then(status => {
			if (!disposed) {
				setGitStatus(status);
			}
		});
		return () => { disposed = true; };
	}, [gitStatus, services]);

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

	// Until Git can clone, show why instead of the form.
	if (gitStatus !== 'available') {
		return <GitStatusModalDialog gitStatus={gitStatus} renderer={props.renderer} />;
	}

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
				try {
					await props.createFolder(result);
				} catch (err) {
					// The Git extension reports clone failures itself, so this sees only a clone
					// that never started. The dialog is gone, so notify instead, without the URL,
					// which can contain credentials.
					services.notificationService.error(localize(
						'positron.gitCloneFailed',
						"Could not clone the repository: {0}",
						toErrorMessage(err)
					));
				}
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
 * Gets the services the Git status checks read.
 * @param services The Positron React services.
 * @returns The services for checkGitStatus and getGitStatusNow.
 */
function gitStatusServices(services: PositronReactServices) {
	return {
		extensionService: services.extensionService,
		commandRegistry: CommandsRegistry,
		contextKeyService: services.contextKeyService,
		configurationService: services.configurationService,
	};
}

/**
 * GitStatusModalDialogProps interface.
 */
interface GitStatusModalDialogProps {
	renderer: PositronModalReactRenderer;
	gitStatus: Exclude<GitStatus, 'available'> | 'checking';
}

/**
 * Renders a localized message whose {0} placeholder is a setting name, with the setting name in
 * code font.
 * @param message The localized message, with its {0} placeholder left unformatted.
 * @param setting The setting name.
 * @returns The rendered message.
 */
const MessageWithSetting = ({ message, setting }: { message: string; setting: string }) => {
	const [before, after] = message.split('{0}');
	return <p>{before}<code>{setting}</code>{after}</p>;
};

/**
 * GitStatusModalDialog component. Explains why Git cannot clone. The dialog blocks the rest of the
 * window, so the user fixes the problem after closing it; the only fix it offers itself is opening
 * the 'git.enabled' setting, which closes the dialog first.
 * @param props The component properties.
 * @returns The rendered component.
 */
const GitStatusModalDialog = (props: GitStatusModalDialogProps) => {
	const services = usePositronReactServicesContext();

	const close = () => props.renderer.dispose();
	const okFooter = <OneButtonFooter buttonTitle={localize('positronOK', "OK")} onButton={close} />;

	let content: ReactNode;
	let footer: ReactNode;
	switch (props.gitStatus) {
		case 'checking':
			content = <p>{localize('positron.gitChecking', "Checking for Git...")}</p>;
			footer = <OneButtonFooter buttonTitle={localize('positronCancel', "Cancel")} onButton={close} />;
			break;
		case 'missing':
			content = <>
				<p className='git-status-heading'>{localize('positron.gitNotFound', "Git was not found.")}</p>
				<MessageWithSetting
					message={localize(
						'positron.gitNotFoundDetail',
						"To create a folder from a Git repository, install Git, then reload the window. If Git is installed in a location that Positron does not search, set the {0} setting."
					)}
					setting='git.path'
				/>
			</>;
			footer = okFooter;
			break;
		case 'disabled':
			content = <>
				<p className='git-status-heading'>{localize('positron.gitTurnedOff', "Git is turned off.")}</p>
				<MessageWithSetting
					message={localize(
						'positron.gitTurnedOffDetail',
						"To create a folder from a Git repository, turn on the {0} setting."
					)}
					setting='git.enabled'
				/>
			</>;
			footer = <TwoButtonFooter
				primaryButtonTitle={localize('positron.gitOpenSettings', "Open Settings")}
				secondaryButtonTitle={localize('positronCancel', "Cancel")}
				onPrimaryButton={() => {
					// Close the dialog first; it would otherwise cover the Settings editor.
					close();
					services.commandService.executeCommand('workbench.action.openSettings', 'git.enabled');
				}}
				onSecondaryButton={close}
			/>;
			break;
		case 'notReady':
			content = <>
				<p className='git-status-heading'>{localize('positron.gitExtensionNotReady', "The Git extension is not ready.")}</p>
				<p>{localize(
					'positron.gitExtensionNotReadyDetail',
					"Make sure that the built-in Git extension is enabled, then reload the window."
				)}</p>
			</>;
			footer = okFooter;
			break;
	}

	// Render.
	return (
		<PositronDynamicModalDialog
			content={<div className='git-status'>{content}</div>}
			footer={footer}
			renderer={props.renderer}
			title={localize(
				'positronNewFolderFromGitModalDialogTitle',
				"New Folder from Git"
			)}
			width={400}
			onCancel={close}
		/>
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
