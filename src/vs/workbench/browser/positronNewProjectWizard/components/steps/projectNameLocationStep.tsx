/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { useNewProjectWizardContext } from '../../newProjectWizardContext.js';
import { URI } from '../../../../../base/common/uri.js';
import { NewProjectWizardStep } from '../../interfaces/newProjectWizardEnums.js';
import { NewProjectWizardStepProps } from '../../interfaces/newProjectWizardStepProps.js';
import { PositronWizardStep } from '../wizardStep.js';
import { PositronWizardSubStep } from '../wizardSubStep.js';
import { LabeledTextInput } from '../../../positronComponents/positronModalDialog/components/labeledTextInput.js';
import { LabeledFolderInput } from '../../../positronComponents/positronModalDialog/components/labeledFolderInput.js';
import { Checkbox } from '../../../positronComponents/positronModalDialog/components/checkbox.js';
import { WizardFormattedText, WizardFormattedTextType } from '../wizardFormattedText.js';
import { checkProjectName } from '../../utilities/projectNameUtils.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { NewProjectType } from '../../../../services/positronNewProject/common/positronNewProject.js';
import { checkIfPathValid, checkIfURIExists } from '../../../positronComponents/positronModalDialog/components/fileInputValidators.js';
import { PathDisplay } from '../pathDisplay.js';
import { useDebouncedValidator } from '../../../positronComponents/positronModalDialog/components/useDebouncedValidator.js';

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
	const { fileDialogService, fileService, logService, pathService } = context.services;

	// Hooks.
	const [projectName, setProjectName] = useState(context.projectName);
	const [parentFolder, setParentFolder] = useState(context.parentFolder);
	const [projectNameFeedback, setProjectNameFeedback] = useState(context.projectNameFeedback);
	// TODO: Merge `nameValidationErrorMsg` and `parentPathErrorMsg` with the `checkProjectName()`
	// function.
	const nameValidationErrorMsg = useDebouncedValidator({
		value: projectName,
		validator: x => checkIfPathValid(x, { parentPath: parentFolder.fsPath })
	});
	const isInvalidName = nameValidationErrorMsg !== undefined;
	const parentPathErrorMsg = useDebouncedValidator({
		value: parentFolder,
		validator: (path: URI) => checkIfURIExists(path, fileService)
	});
	const isInvalidParentPath = parentPathErrorMsg !== undefined;


	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onUpdateProjectConfig event handler and update the component state.
		disposableStore.add(context.onUpdateProjectDirectory(() => {
			setProjectName(context.projectName);
			setParentFolder(context.parentFolder);
			setProjectNameFeedback(context.projectNameFeedback);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context]);

	// The browse handler.
	const browseHandler = async () => {
		// Show the open dialog.
		const uri = await fileDialogService.showOpenDialog({
			defaultUri: parentFolder,
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
		});

		// If the user made a selection, set the parent directory.
		if (uri?.length) {
			onChangeParentFolder(uri[0]);
		}
	};

	// Update the project name and the project name feedback.
	const onChangeProjectName = async (name: string) => {
		context.projectName = name.trim();
		context.projectNameFeedback = await checkProjectName(
			name,
			parentFolder,
			pathService,
			fileService
		);
	};

	// Update the parent folder and the project name feedback.
	const onChangeParentFolder = async (folder: URI) => {
		context.parentFolder = folder;
		context.projectNameFeedback = await checkProjectName(
			projectName,
			folder,
			pathService,
			fileService
		);
	};

	// Navigate to the next step in the wizard, based on the selected project type.
	const nextStep = () => {
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
					maxLength={255 - parentFolder.fsPath.length}
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
								pathComponents={[parentFolder.fsPath, projectName]}
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
					value={parentFolder.fsPath}
					onBrowse={browseHandler}
					error={Boolean(parentPathErrorMsg)}
					skipValidation
					onChange={(e) => onChangeParentFolder(parentFolder.with({ path: e.target.value }))}
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
