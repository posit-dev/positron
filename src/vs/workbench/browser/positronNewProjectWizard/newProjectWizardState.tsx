/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStep';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * NewProjectWizardServices interface. Defines the set of services that are required by the New
 * Project Wizard.
 */
export interface NewProjectWizardServices {
	fileDialogService: IFileDialogService;
	keybindingService: IKeybindingService;
	languageRuntimeService: ILanguageRuntimeService;
	layoutService: IWorkbenchLayoutService;
	logService: ILogService;
	runtimeSessionService: IRuntimeSessionService;
	runtimeStartupService: IRuntimeStartupService;
}

/**
 * NewProjectWizardStateProps interface. Defines the set of properties to initialize the New Project
 * Wizard state.
 */
export interface NewProjectWizardStateProps {
	readonly services: NewProjectWizardServices;
	readonly parentFolder: string;
}

/**
 * NewProjectType enum. Defines the types of projects that can be created.
 * TODO: this should be moved to a more appropriate location.
 * TODO: localize. Since this is an enum, we can't use the localize function
 * because computed values must be numbers (not strings). So we'll probably need to
 * turn this into an object with keys and values, maybe also using something like
 * satisfies Readonly<Record<string, string>>.
 */
export enum NewProjectType {
	PythonProject = 'Python Project',
	RProject = 'R Project',
	JupyterNotebook = 'Jupyter Notebook'
}

/**
 * NewProjectConfiguration interface. Defines the configuration for a new project.
 * This information is used to initialize the workspace for a new project.
 */
export interface NewProjectConfiguration {
	readonly selectedRuntime: ILanguageRuntimeMetadata;
	readonly projectType: NewProjectType | '';
	readonly projectName: string;
	readonly parentFolder: string;
	readonly initGitRepo: boolean;
	readonly openInNewWindow: boolean;
	readonly pythonEnvType?: string;
}

/**
 * NewProjectWizardState interface. Defines the state of the New Project Wizard.
 */
export interface NewProjectWizardState extends NewProjectWizardServices {
	projectConfig: NewProjectConfiguration;
	wizardSteps: NewProjectWizardStep[]; // TODO: remove: this is for debugging
	currentStep: NewProjectWizardStep;
	setProjectConfig(config: NewProjectConfiguration): void;
	goToNextStep: (step: NewProjectWizardStep) => void;
	goToPreviousStep: () => void;
}

/**
 * The useNewProjectWizardState hook. This hook initializes the state for the New Project Wizard.
 * @param props The NewProjectWizardStateProps.
 * @returns The initial NewProjectWizardState.
 */
export const useNewProjectWizardState = (
	props: NewProjectWizardStateProps
): NewProjectWizardState => {
	// Hooks.
	const [projectConfig, setProjectConfig] = useState<NewProjectConfiguration>({
		selectedRuntime: props.services.languageRuntimeService.registeredRuntimes[0],
		projectType: '',
		projectName: '',
		parentFolder: props.parentFolder ?? '',
		initGitRepo: false,
		openInNewWindow: true,
		pythonEnvType: ''
	});

	// TODO: the initial step should be passed in via the props
	const [wizardSteps, setWizardSteps] = useState([NewProjectWizardStep.ProjectTypeSelection]);
	const [currentStep, setCurrentStep] = useState(NewProjectWizardStep.ProjectTypeSelection);

	// Go to the next step by pushing the next step onto the stack of steps,
	// and setting the new current step to the next step.
	const goToNextStep = (step: NewProjectWizardStep) => {
		setWizardSteps([...wizardSteps, step]);
		setCurrentStep(step);
	};

	// Go to the previous step by popping the current step off the stack,
	// and setting the new current step to the previous step.
	const goToPreviousStep = () => {
		// TODO: if the current step is the only step and this function is called,
		// should this be a no-op?
		const steps = wizardSteps;
		steps.pop();
		setWizardSteps(steps);
		if (steps.length === 0) {
			setCurrentStep(NewProjectWizardStep.None);
			return;
		}
		setCurrentStep(steps[steps.length - 1]);
	};

	// Return the New Project Wizard state.
	return {
		...props.services,
		projectConfig,
		wizardSteps, // TODO: remove: this is for debugging
		currentStep,
		setProjectConfig,
		goToNextStep,
		goToPreviousStep,
	};
};
