/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { useNewProjectWizardContext } from '../../newProjectWizardContext.js';
import { NewProjectWizardStep } from '../../interfaces/newProjectWizardEnums.js';
import { NewProjectWizardStepProps } from '../../interfaces/newProjectWizardStepProps.js';
import { PositronWizardStep } from '../wizardStep.js';
import { PositronWizardSubStep } from '../wizardSubStep.js';
import { LabeledTextInput } from '../../../positronComponents/positronModalDialog/components/labeledTextInput.js';
import { LabeledFolderInput } from '../../../positronComponents/positronModalDialog/components/labeledFolderInput.js';
import { Checkbox } from '../../../positronComponents/positronModalDialog/components/checkbox.js';
import { WizardFormattedText, WizardFormattedTextType } from '../wizardFormattedText.js';
import { checkProjectName, getMaxProjectPathLength } from '../../utilities/projectNameUtils.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { NewProjectType } from '../../../../services/positronNewProject/common/positronNewProject.js';
import { checkIfPathValid, checkIfURIExists } from '../../../positronComponents/positronModalDialog/components/fileInputValidators.js';
import { PathDisplay } from '../pathDisplay.js';
import { useDebouncedValidator } from '../../../positronComponents/positronModalDialog/components/useDebouncedValidator.js';
import { combineLabelWithPathUri, pathUriToLabel } from '../../../utils/path.js';

/**
 * The ProjectNameLocationStep component is the second step in the new project wizard.
 * This component is shared by all project types. The next step in the wizard is determined by the
 * selected project type.
 * @param props The NewProjectWizardStepProps
 * @returns The rendered component
 */
export const ProjectNameLocationStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	// State.
	const context = useNewProjectWizardContext();
	const { fileDialogService, fileService, labelService, logService, pathService } = context.services;

	// Hooks.
	const [projectName, setProjectName] = useState(context.projectName);
	const [parentFolder, setParentFolder] = useState(() => pathUriToLabel(context.parentFolder, labelService));
	const [projectNameFeedback, setProjectNameFeedback] = useState(context.projectNameFeedback);
	const [maxProjectPathLength, setMaxProjectPathLength] = useState(() => getMaxProjectPathLength(parentFolder.length));
	// TODO: Merge `nameValidationErrorMsg` and `parentPathErrorMsg` with the `checkProjectName()`
	// function.
	const nameValidationErrorMsg = useDebouncedValidator({
		value: projectName,
		validator: name => checkIfPathValid(name, {
			parentPath: parentFolder
		})
	});
	const isInvalidName = nameValidationErrorMsg !== undefined;
	const parentPathErrorMsg = useDebouncedValidator({
		value: parentFolder,
		validator: async folder => {
			const pathUri = await combineLabelWithPathUri(folder, context.parentFolder, pathService);
			return checkIfURIExists(pathUri, fileService);
		}
	});
	const isInvalidParentPath = parentPathErrorMsg !== undefined;

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onUpdateProjectConfig event handler and update the component state.
		disposableStore.add(context.onUpdateProjectDirectory(() => {
			setProjectName(context.projectName);
			setProjectNameFeedback(context.projectNameFeedback);
			setMaxProjectPathLength(() => getMaxProjectPathLength(context.parentFolder.path.length));
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
		context.projectName = name.trim();
		const parentFolderUri = await combineLabelWithPathUri(
			parentFolder,
			context.parentFolder,
			pathService
		);
		context.projectNameFeedback = await checkProjectName(
			name,
			parentFolderUri,
			fileService
		);
	};

	// Update the parent folder and the project name feedback.
	const onChangeParentFolder = async (folder: string) => {
		// Update the parent folder component state. The parent folder URI will be updated in the
		// project wizard context when the user navigates to the next step.
		setParentFolder(folder);

		// Check that the project name is still valid.
		const parentFolderUri = await combineLabelWithPathUri(
			folder,
			context.parentFolder,
			pathService
		);
		context.projectNameFeedback = await checkProjectName(
			projectName,
			parentFolderUri,
			fileService
		);
	};

	// Navigate to the next step in the wizard, based on the selected project type.
	const nextStep = async () => {
		// Update the parent folder URI in the context before navigating to the next step.
		context.parentFolder = await combineLabelWithPathUri(
			parentFolder,
			context.parentFolder,
			pathService
		);

		switch (context.projectType) {
			case NewProjectType.RProject:
				props.next(NewProjectWizardStep.RConfiguration);
				break;
			case NewProjectType.JupyterNotebook:
			// TODO: Provide a step to choose the notebook language for Jupyter notebooks.
			// For now, navigate to the Python environment step.
			case NewProjectType.PythonProject:
				props.next(NewProjectWizardStep.PythonEnvironment);
				break;
			default:
				logService.error(
					'No next step in project wizard found for project type: ' +
					context.projectType
				);
				break;
		}
	};

	// Render.
	return (
		<PositronWizardStep
			backButtonConfig={{ onClick: props.back }}
			cancelButtonConfig={{ onClick: props.cancel }}
			nextButtonConfig={{
				onClick: nextStep,
				disable:
					!projectName ||
					isInvalidName ||
					isInvalidParentPath ||
					!parentFolder ||
					(projectNameFeedback &&
						projectNameFeedback.type === WizardFormattedTextType.Error),
			}}
			title={(() =>
				localize(
					'projectNameLocationStep.title',
					"Set project name and location"
				))()}
		>
			<PositronWizardSubStep
				feedback={
					projectNameFeedback ? (
						<WizardFormattedText type={projectNameFeedback.type}>
							{projectNameFeedback.text}
						</WizardFormattedText>
					) : nameValidationErrorMsg ?
						<WizardFormattedText type={WizardFormattedTextType.Error}>
							{nameValidationErrorMsg}
						</WizardFormattedText>
						: undefined
				}
				title={(() =>
					localize(
						'projectNameLocationSubStep.projectName.label',
						"Project Name"
					))()}
			>
				<LabeledTextInput
					autoFocus
					error={
						(projectNameFeedback &&
							projectNameFeedback.type === WizardFormattedTextType.Error) ||
						Boolean(nameValidationErrorMsg)
					}
					label={(() =>
						localize(
							'projectNameLocationSubStep.projectName.description',
							"Enter a name for your new {0}",
							context.projectType
						))()}
					// Don't let the user create a project with a location that is too long.
					maxLength={maxProjectPathLength}
					type='text'
					value={projectName}
					onChange={(e) => onChangeProjectName(e.target.value)}
				/>
			</PositronWizardSubStep>
			<PositronWizardSubStep
				feedback={
					parentPathErrorMsg ?
						<WizardFormattedText type={WizardFormattedTextType.Error}>
							{parentPathErrorMsg}
						</WizardFormattedText> :
						<WizardFormattedText type={WizardFormattedTextType.Info}>
							{(() =>
								localize(
									'projectNameLocationSubStep.parentDirectory.feedback',
									"Your project will be created at: "
								))()}
							<PathDisplay
								pathComponents={[
									parentFolder,
									projectName
								]}
								pathService={pathService}
							/>
						</WizardFormattedText>
				}
				title={(() =>
					localize(
						'projectNameLocationSubStep.parentDirectory.label',
						"Parent Directory"
					))()}
			>
				<LabeledFolderInput
					skipValidation
					error={Boolean(parentPathErrorMsg)}
					label={(() =>
						localize(
							'projectNameLocationSubStep.parentDirectory.description',
							"Select a directory to create your project in"
						))()}
					value={parentFolder}
					onBrowse={browseHandler}
					onChange={(e) => onChangeParentFolder(e.target.value)}
				/>
			</PositronWizardSubStep>
			<PositronWizardSubStep
				titleId='misc-proj-options'
			>
				{/* TODO: display a warning/message if the user doesn't have git set up */}
				<Checkbox
					initialChecked={context.initGitRepo}
					label={(() =>
						localize(
							'projectNameLocationSubStep.initGitRepo.label',
							"Initialize project as Git repository"
						))()}
					onChanged={(checked) => context.initGitRepo = checked}
				/>
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
