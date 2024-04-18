/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { EnvironmentSetupType, NewProjectType, NewProjectWizardStep, PythonEnvironmentType } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILogService } from 'vs/platform/log/common/log';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IFileService } from 'vs/platform/files/common/files';

/**
 * NewProjectWizardServices interface. Defines the set of services that are required by the New
 * Project Wizard.
 */
interface NewProjectWizardServices {
	fileDialogService: IFileDialogService;
	fileService: IFileService;
	keybindingService: IKeybindingService;
	languageRuntimeService: ILanguageRuntimeService;
	layoutService: IWorkbenchLayoutService;
	logService: ILogService;
	openerService: IOpenerService;
	pathService: IPathService;
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
 * NewProjectConfiguration interface. Defines the configuration for a new project.
 * This information is used to initialize the workspace for a new project.
 */
export interface NewProjectConfiguration {
	readonly selectedRuntime: ILanguageRuntimeMetadata | undefined;
	readonly projectType: NewProjectType | undefined;
	readonly projectName: string;
	readonly parentFolder: string;
	readonly initGitRepo: boolean;
	readonly openInNewWindow: boolean;
	readonly pythonEnvSetupType: EnvironmentSetupType | undefined;
	readonly pythonEnvType: PythonEnvironmentType | undefined;
	readonly installIpykernel: boolean | undefined;
	readonly useRenv: boolean | undefined;
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
		selectedRuntime: undefined,
		projectType: undefined,
		projectName: '',
		parentFolder: props.parentFolder ?? '',
		initGitRepo: false,
		openInNewWindow: true,
		pythonEnvSetupType: undefined,
		pythonEnvType: undefined,
		installIpykernel: undefined,
		useRenv: undefined
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
