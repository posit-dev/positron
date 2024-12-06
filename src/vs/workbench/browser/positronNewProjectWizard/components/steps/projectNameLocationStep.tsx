/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStepProps';
import { PositronWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardStep';
import { PositronWizardSubStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardSubStep';
import { LabeledTextInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledTextInput';
import { LabeledFolderInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledFolderInput';
import { Checkbox } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/checkbox';
import { WizardFormattedText, WizardFormattedTextType } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardFormattedText';
import { checkProjectName, getMaxProjectPathLength } from 'vs/workbench/browser/positronNewProjectWizard/utilities/projectNameUtils';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { NewProjectType } from 'vs/workbench/services/positronNewProject/common/positronNewProject';
import { checkIfPathValid, checkIfURIExists } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/fileInputValidators';
import { PathDisplay } from 'vs/workbench/browser/positronNewProjectWizard/components/pathDisplay';
import { useDebouncedValidator } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/useDebouncedValidator';
import { combineLabelWithPathUri, pathUriToLabel } from 'vs/workbench/browser/utils/path';

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
		setParentFolder(folder);
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
		context.parentFolder = await combineLabelWithPathUri(parentFolder, context.parentFolder, pathService)

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
			title={(() =>
				localize(
					'projectNameLocationStep.title',
					"Set project name and location"
				))()}
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
			backButtonConfig={{ onClick: props.back }}
		>
			<PositronWizardSubStep
				title={(() =>
					localize(
						'projectNameLocationSubStep.projectName.label',
						"Project Name"
					))()}
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
			>
				<LabeledTextInput
					label={(() =>
						localize(
							'projectNameLocationSubStep.projectName.description',
							"Enter a name for your new {0}",
							context.projectType
						))()}
					autoFocus
					value={projectName}
					onChange={(e) => onChangeProjectName(e.target.value)}
					type='text'
					// Don't let the user create a project with a location that is too long.
					maxLength={maxProjectPathLength}
					error={
						(projectNameFeedback &&
							projectNameFeedback.type === WizardFormattedTextType.Error) ||
						Boolean(nameValidationErrorMsg)
					}
				/>
			</PositronWizardSubStep>
			<PositronWizardSubStep
				title={(() =>
					localize(
						'projectNameLocationSubStep.parentDirectory.label',
						"Parent Directory"
					))()}
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
			>
				<LabeledFolderInput
					label={(() =>
						localize(
							'projectNameLocationSubStep.parentDirectory.description',
							"Select a directory to create your project in"
						))()}
					value={parentFolder}
					onBrowse={browseHandler}
					error={Boolean(parentPathErrorMsg)}
					skipValidation
					onChange={async (e) => onChangeParentFolder(e.target.value)}
				/>
			</PositronWizardSubStep>
			<PositronWizardSubStep
				titleId='misc-proj-options'
			>
				{/* TODO: display a warning/message if the user doesn't have git set up */}
				<Checkbox
					label={(() =>
						localize(
							'projectNameLocationSubStep.initGitRepo.label',
							"Initialize project as Git repository"
						))()}
					onChanged={(checked) => context.initGitRepo = checked}
					initialChecked={context.initGitRepo}
				/>
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
