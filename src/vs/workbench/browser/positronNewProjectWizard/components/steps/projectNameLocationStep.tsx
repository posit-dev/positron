/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { URI } from 'vs/base/common/uri';
import { NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStepProps';
import { PositronWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardStep';
import { PositronWizardSubStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardSubStep';
import { LabeledTextInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledTextInput';
import { LabeledFolderInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledFolderInput';
import { Checkbox } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/checkbox';
import { WizardFormattedText, WizardFormattedTextType } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardFormattedText';
import { checkProjectName } from 'vs/workbench/browser/positronNewProjectWizard/utilities/projectNameUtils';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { NewProjectType } from 'vs/workbench/services/positronNewProject/common/positronNewProject';

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
			defaultUri: URI.file(parentFolder),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
		});

		// If the user made a selection, set the parent directory.
		if (uri?.length) {
			onChangeParentFolder(uri[0].fsPath);
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
	const onChangeParentFolder = async (folder: string) => {
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
					) : undefined
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
					error={
						projectNameFeedback &&
						projectNameFeedback.type === WizardFormattedTextType.Error
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
					<WizardFormattedText type={WizardFormattedTextType.Info}>
						{(() =>
							localize(
								'projectNameLocationSubStep.parentDirectory.feedback',
								"Your project will be created at: "
							))()}
						<code>
							{parentFolder}/{projectName}
						</code>
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
					onChange={(e) => onChangeParentFolder(e.target.value)}
				/>
			</PositronWizardSubStep>
			<PositronWizardSubStep>
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
