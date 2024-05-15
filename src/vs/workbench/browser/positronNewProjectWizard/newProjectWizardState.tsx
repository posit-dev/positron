/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useState } from 'react';

// Other dependencies.
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { EnvironmentSetupType, NewProjectType, NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILogService } from 'vs/platform/log/common/log';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IFileService } from 'vs/platform/files/common/files';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { PythonEnvironmentProviderInfo } from 'vs/workbench/browser/positronNewProjectWizard/utilities/pythonEnvironmentStepUtils';

/**
 * NewProjectWizardServices interface. Defines the set of services that are required by the New
 * Project Wizard.
 */
interface NewProjectWizardServices {
	commandService: ICommandService;
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
	readonly pythonEnvProviders: PythonEnvironmentProviderInfo[];
}

/**
 * NewProjectWizardConfiguration interface. Used to keep track of the new project configuration state
 * in the New Project Wizard Modal.
 */
export interface NewProjectWizardConfiguration {
	readonly selectedRuntime: ILanguageRuntimeMetadata | undefined;
	readonly projectType: NewProjectType | undefined;
	readonly projectName: string;
	readonly parentFolder: string;
	readonly initGitRepo: boolean;
	readonly openInNewWindow: boolean;
	readonly pythonEnvSetupType: EnvironmentSetupType | undefined;
	readonly pythonEnvProvider: string | undefined;
	readonly installIpykernel: boolean | undefined;
	readonly useRenv: boolean | undefined;
}

/**
 * NewProjectWizardState interface. Defines the state of the New Project Wizard.
 */
export interface NewProjectWizardState extends NewProjectWizardServices {
	projectConfig: NewProjectWizardConfiguration;
	wizardSteps: NewProjectWizardStep[]; // TODO: remove: this is for debugging
	currentStep: NewProjectWizardStep;
	pythonEnvProviders: PythonEnvironmentProviderInfo[];
	setProjectConfig(config: NewProjectWizardConfiguration): void;
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
	const [projectConfig, setProjectConfig] = useState<NewProjectWizardConfiguration>({
		selectedRuntime: undefined,
		projectType: undefined,
		projectName: '',
		parentFolder: props.parentFolder ?? '',
		initGitRepo: false,
		openInNewWindow: false,
		pythonEnvSetupType: undefined,
		pythonEnvProvider: undefined,
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
		pythonEnvProviders: props.pythonEnvProviders,
		setProjectConfig,
		goToNextStep,
		goToPreviousStep,
	};
};
