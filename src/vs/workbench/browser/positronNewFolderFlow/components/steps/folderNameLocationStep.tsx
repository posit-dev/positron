/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { PropsWithChildren, useCallback, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { useNewFolderFlowContext } from '../../newFolderFlowContext.js';
import { NewFolderFlowStep } from '../../interfaces/newFolderFlowEnums.js';
import { NewFolderFlowStepProps } from '../../interfaces/newFolderFlowStepProps.js';
import { PositronFlowStep } from '../flowStep.js';
import { PositronFlowSubStep } from '../flowSubStep.js';
import { LabeledTextInput } from '../../../positronComponents/positronModalDialog/components/labeledTextInput.js';
import { LabeledFolderInput } from '../../../positronComponents/positronModalDialog/components/labeledFolderInput.js';
import { Checkbox } from '../../../positronComponents/positronModalDialog/components/checkbox.js';
import { FlowFormattedText, FlowFormattedTextType } from '../flowFormattedText.js';
import { checkFolderName, getMaxFolderPathLength } from '../../utilities/folderNameUtils.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { FolderTemplate } from '../../../../services/positronNewFolder/common/positronNewFolder.js';
import { checkIfPathValid, checkIfURIExists } from '../../../positronComponents/positronModalDialog/components/fileInputValidators.js';
import { PathDisplay } from '../pathDisplay.js';
import { useDebouncedValidator } from '../../../positronComponents/positronModalDialog/components/useDebouncedValidator.js';
import { combineLabelWithPathUri, pathUriToLabel } from '../../../utils/path.js';
import { ActionBarButtonConfig } from '../../../positronComponents/positronModalDialog/components/okCancelBackNextActionBar.js';
import { checkCanCreateFolderIn } from '../../../utils/createFolder.js';
import { URI } from '../../../../../base/common/uri.js';

// OK button configuration interface.
interface OKButtonConfig {
	okButtonConfig: ActionBarButtonConfig;
}

// Next button configuration interface.
interface NextButtonConfig {
	nextButtonConfig: ActionBarButtonConfig;
}

// OK / Next button union type.
type OKNextButtonConfig = OKButtonConfig | NextButtonConfig;

/**
 * The FolderNameLocationStep component is the second step in the New Folder Flow.
 * This component is shared by all folder templates. The next step in the flow is determined by the
 * selected folder template.
 * @param props The NewFolderFlowStepProps
 * @returns The rendered component
 */
export const FolderNameLocationStep = (props: PropsWithChildren<NewFolderFlowStepProps>) => {
	// State.
	const context = useNewFolderFlowContext();
	const { fileDialogService, fileService, labelService, logService, pathService } = context.services;

	// Hooks.
	const [folderName, setFolderName] = useState(context.folderName);
	const [parentFolder, setParentFolder] = useState(() => pathUriToLabel(context.parentFolder, labelService));
	const [folderNameFeedback, setFolderNameFeedback] = useState(context.folderNameFeedback);
	// Set by the location check that runs when Next or Create is pressed.
	const [locationError, setLocationError] = useState<string | undefined>(undefined);
	const [maxFolderPathLength, setMaxFolderPathLength] = useState(() => getMaxFolderPathLength(parentFolder.length));
	// TODO: Merge `nameValidationErrorMsg` and `parentPathErrorMsg` with the `checkProjectName()`
	// function.
	const nameValidationErrorMsg = useDebouncedValidator({
		value: folderName,
		validator: name => checkIfPathValid(name, {
			parentPath: parentFolder
		})
	});
	const isInvalidName = nameValidationErrorMsg !== undefined;
	// Checks that the location exists and that the user can create a folder in it. Memoized, so the
	// debounced validation reruns when the location changes, not on every render.
	const validateLocation = useCallback(async (pathUri: URI) =>
		await checkIfURIExists(pathUri, fileService) ??
		await checkCanCreateFolderIn(pathUri, context.services),
		[context, fileService]
	);
	const validateParentFolder = useCallback(async (folder: string) =>
		validateLocation(await combineLabelWithPathUri(folder, context.parentFolder, pathService)),
		[context, pathService, validateLocation]
	);
	const parentPathErrorMsg = useDebouncedValidator({
		value: parentFolder,
		validator: validateParentFolder
	});
	const isInvalidParentPath = parentPathErrorMsg !== undefined;

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onUpdateProjectConfig event handler and update the component state.
		disposableStore.add(context.onUpdateFolderPath(() => {
			setFolderName(context.folderName);
			setFolderNameFeedback(context.folderNameFeedback);
			setMaxFolderPathLength(() => getMaxFolderPathLength(context.parentFolder.path.length));
			// The parent folder state is local to this component, so we don't update it here.
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context]);

	// The browse handler.
	const browseHandler = async () => {
		// Construct the parent folder URI.
		const parentFolderUri = await combineLabelWithPathUri(
			parentFolder,
			context.parentFolder,
			pathService
		);

		// Show the open dialog.
		const uri = await fileDialogService.showOpenDialog({
			defaultUri: parentFolderUri,
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
		});

		// If the user made a selection, set the parent directory.
		if (uri?.length) {
			const pathLabel = pathUriToLabel(uri[0], labelService);
			onChangeParentFolder(pathLabel);
		}
	};

	// Update the project name and the project name feedback.
	const onChangeProjectName = async (name: string) => {
		setLocationError(undefined);
		context.folderName = name.trim();
		const parentFolderUri = await combineLabelWithPathUri(
			parentFolder,
			context.parentFolder,
			pathService
		);
		context.folderNameFeedback = await checkFolderName(
			name,
			parentFolderUri,
			fileService
		);
	};

	// Update the parent folder and the project name feedback.
	const onChangeParentFolder = async (folder: string) => {
		// Update the parent folder component state. The parent folder URI will be updated in the
		// context when the user navigates to the next step.
		setParentFolder(folder);
		setLocationError(undefined);

		// Check that the project name is still valid.
		const parentFolderUri = await combineLabelWithPathUri(
			folder,
			context.parentFolder,
			pathService
		);
		context.folderNameFeedback = await checkFolderName(
			folderName,
			parentFolderUri,
			fileService
		);
	};

	// Update the parent folder URI in the context.
	const updateParentFolder = async () => {
		context.parentFolder = await combineLabelWithPathUri(
			parentFolder,
			context.parentFolder,
			pathService
		);
	};

	// Next and Create can be pressed before the debounced location validation finishes, so the
	// location is checked again here.
	const updateAndCheckLocation = async () => {
		await updateParentFolder();
		const error = await validateLocation(context.parentFolder);
		setLocationError(error);
		return error === undefined;
	};

	// Navigate to the next step in the flow, based on the selected project type.
	const nextStep = async () => {
		if (!await updateAndCheckLocation()) {
			return;
		}

		switch (context.folderTemplate) {
			case FolderTemplate.RProject:
				props.next(NewFolderFlowStep.RConfiguration);
				break;
			case FolderTemplate.JupyterNotebook:
			// TODO: Provide a step to choose the notebook language for Jupyter notebooks.
			// For now, navigate to the Python environment step.
			case FolderTemplate.PythonProject:
				props.next(NewFolderFlowStep.PythonEnvironment);
				break;
			default:
				logService.error(
					'No next step found for project type: ' +
					context.folderTemplate
				);
				break;
		}
	};

	// Determine if the OK / Next button should be disabled.
	const okNextButtonDisabled = !folderName ||
		isInvalidName ||
		isInvalidParentPath ||
		!parentFolder ||
		(folderNameFeedback && folderNameFeedback.type === FlowFormattedTextType.Error);

	// Determine if configuration is needed for the next step.
	const configurationNeeded = context.folderTemplate !== FolderTemplate.EmptyProject;

	// Configure the OK / Next button based on whether configuration is needed.
	let okNextButtonConfig: OKNextButtonConfig;
	if (configurationNeeded) {
		okNextButtonConfig = {
			nextButtonConfig: {
				onClick: nextStep,
				disable: okNextButtonDisabled,
				title: localize(
					'positronNewFolderFlow.nextButtonTitle',
					"Next"
				)
			}
		};
	} else {
		okNextButtonConfig = {
			okButtonConfig: {
				onClick: async () => {
					if (await updateAndCheckLocation()) {
						props.accept();
					}
				},
				disable: okNextButtonDisabled,
				title: localize(
					'positronNewFolderFlow.createButtonTitle',
					"Create"
				)
			}
		};
	}

	// Render.
	return (
		<PositronFlowStep
			backButtonConfig={{ onClick: props.back }}
			{...okNextButtonConfig}
			title={localize(
				'folderNameLocationStep.title',
				"Folder Name and Location"
			)}
		>
			<PositronFlowSubStep
				feedback={
					folderNameFeedback ? (
						<FlowFormattedText type={folderNameFeedback.type}>
							{folderNameFeedback.text}
						</FlowFormattedText>
					) : nameValidationErrorMsg ?
						<FlowFormattedText type={FlowFormattedTextType.Error}>
							{nameValidationErrorMsg}
						</FlowFormattedText>
						: undefined
				}
				title={localize(
					'folderNameLocationSubStep.folderName.label',
					"Folder Name"
				)}
			>
				<LabeledTextInput
					autoFocus
					error={
						(folderNameFeedback &&
							folderNameFeedback.type === FlowFormattedTextType.Error) ||
						Boolean(nameValidationErrorMsg)
					}
					label={localize(
						'folderNameLocationSubStep.folderName.description',
						"Enter the name of your new {0} folder",
						context.folderTemplate
					)}
					// Don't let the user create a folder with a location that is too long.
					maxLength={maxFolderPathLength}
					type='text'
					value={folderName}
					onChange={(e) => onChangeProjectName(e.target.value)}
				/>
			</PositronFlowSubStep>
			<PositronFlowSubStep
				feedback={
					parentPathErrorMsg || locationError ?
						<FlowFormattedText type={FlowFormattedTextType.Error}>
							{parentPathErrorMsg ?? locationError}
						</FlowFormattedText> :
						<FlowFormattedText type={FlowFormattedTextType.Info}>
							{/* One span, so the path wraps with the sentence instead of beside it. */}
							<span>
								{localize(
									'folderNameLocationSubStep.parentFolder.feedback',
									"New folder will be created at "
								)}
								<PathDisplay
									pathComponents={[
										parentFolder,
										folderName
									]}
									pathService={pathService}
								/>
							</span>
						</FlowFormattedText>
				}
				title={localize(
					'folderNameLocationSubStep.parentFolder.label',
					"Location"
				)}
			>
				<LabeledFolderInput
					skipValidation
					error={Boolean(parentPathErrorMsg || locationError)}
					label={localize(
						'folderNameLocationSubStep.parentFolder.description',
						"Select the location of your new {0} folder",
						context.folderTemplate
					)}
					value={parentFolder}
					onBrowse={browseHandler}
					onChange={(e) => onChangeParentFolder(e.target.value)}
				/>
			</PositronFlowSubStep>
			<PositronFlowSubStep
				titleId='misc-proj-options'
			>
				{/* TODO: display a warning/message if the user doesn't have git set up */}
				<Checkbox
					initialChecked={context.initGitRepo}
					label={localize(
						'folderNameLocationSubStep.initGitRepo.label',
						"Initialize Git repository"
					)}
					onChanged={(checked) => context.initGitRepo = checked}
				/>
				{context.folderTemplate === FolderTemplate.PythonProject && (
					<Checkbox
						initialChecked={context.createPyprojectToml}
						label={localize(
							'folderNameLocationSubStep.createPyprojectToml.label',
							"Create pyproject.toml file"
						)}
						onChanged={(checked) => context.createPyprojectToml = checked}
					/>
				)}
			</PositronFlowSubStep>
		</PositronFlowStep>
	);
};
