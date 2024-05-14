/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService, RuntimeStartupPhase } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { EnvironmentSetupType, NewProjectType, NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILogService } from 'vs/platform/log/common/log';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IFileService } from 'vs/platform/files/common/files';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { PythonEnvironmentProviderInfo } from 'vs/workbench/browser/positronNewProjectWizard/utilities/pythonEnvironmentStepUtils';
import { Disposable } from 'vs/base/common/lifecycle';

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
export interface NewProjectWizardStateConfig {
	readonly services: NewProjectWizardServices;
	readonly parentFolder: string;
	readonly initialStep: NewProjectWizardStep;
	readonly steps?: NewProjectWizardStep[];
}

/**
 * NewProjectWizardConfiguration interface. Used to keep track of the new project configuration state
 * in the New Project Wizard Modal.
 */
export interface NewProjectWizardConfiguration {
	selectedRuntime: ILanguageRuntimeMetadata | undefined;
	projectType: NewProjectType | undefined;
	projectName: string;
	parentFolder: string;
	initGitRepo: boolean;
	openInNewWindow: boolean;
	pythonEnvSetupType: EnvironmentSetupType | undefined;
	pythonEnvProvider: string | undefined;
	installIpykernel: boolean | undefined;
	useRenv: boolean | undefined;
}

/**
 * INewProjectWizardState interface. Defines the state of the New Project Wizard.
 */
export interface INewProjectWizardState {
	projectConfig: NewProjectWizardConfiguration; // (config: NewProjectWizardConfiguration) => void;
	goToNextStep: (step: NewProjectWizardStep) => void;
	goToPreviousStep: () => void;
}

/**
 * NewProjectWizardState class.
 * This class is used to keep track of the state of the New Project Wizard.
 */
export class NewProjectWizardState extends Disposable implements INewProjectWizardState {
	private _services: NewProjectWizardServices;
	private _projectConfig: NewProjectWizardConfiguration;
	private _steps: NewProjectWizardStep[];
	private _currentStep: NewProjectWizardStep;
	private _pythonEnvProviders: PythonEnvironmentProviderInfo[];

	/**
	 * Constructor for the NewProjectWizardState class.
	 * @param config The NewProjectWizardStateConfiguration.
	 */
	constructor(config: NewProjectWizardStateConfig) {
		super();
		this._services = config.services;
		this._projectConfig = {
			selectedRuntime: undefined,
			projectType: undefined,
			projectName: '',
			parentFolder: config.parentFolder ?? '',
			initGitRepo: false,
			openInNewWindow: false,
			pythonEnvSetupType: undefined,
			pythonEnvProvider: undefined,
			installIpykernel: undefined,
			useRenv: undefined,
		};
		this._steps = config.steps ?? [config.initialStep];
		this._currentStep = config.initialStep;
		this._pythonEnvProviders = [];

		this._register(
			this._services.runtimeStartupService.onDidChangeRuntimeStartupPhase(async (phase) => {
				if (phase === RuntimeStartupPhase.Discovering) {
					// At this phase, the extensions that provide language runtimes will have been activated.
					this._pythonEnvProviders = await this._services.commandService.executeCommand(
						'python.getCreateEnvironmentProviders'
					) ?? [];
				}
			}));
	}

	/**
	 * Gets the New Project Wizard state.
	 */
	get projectConfig(): NewProjectWizardConfiguration {
		return this._projectConfig;
	}

	/**
	 * Sets the New Project Wizard state.
	 */
	set projectConfig(config: NewProjectWizardConfiguration) {
		this._projectConfig = config;
	}

	/**
	 * Gets the Python environment providers.
	 */
	get pythonEnvProviders(): PythonEnvironmentProviderInfo[] {
		return this._pythonEnvProviders;
	}

	/**
	 * Gets the current step in the New Project Wizard.
	 */
	get currentStep(): NewProjectWizardStep {
		return this._currentStep;
	}

	/**
	 * Gets the services used by the New Project Wizard.
	 */
	get services(): NewProjectWizardServices {
		return this._services;
	}

	/**
	 * Sets the provided next step as the current step in the New Project Wizard.
	 * Go to the next step by pushing the next step onto the stack of steps,
	 * and setting the new current step to the next step.
	 * @param step The step to go to.
	 * @returns The next step.
	 */
	goToNextStep(step: NewProjectWizardStep): NewProjectWizardStep {
		// If the step already exists in the stack, don't add it again. Although the
		// steps are not expected to be repeated, this check prevents us from adding
		// the same step multiple times.
		const stepAlreadyExists = this._steps.findIndex((s) => s === step) !== -1;
		if (stepAlreadyExists) {
			this._services.logService.error('[Project Wizard] Step already exists');
			return this._currentStep;
		}
		this._steps.push(step);
		this._currentStep = step;
		return this._currentStep;
	}

	/**
	 * Retrieves the previous step in the New Project Wizard and sets it as the current step.
	 * Go to the previous step by popping the current step off the stack,
	 * and setting the new current step to the previous step.
	 * @returns The previous step.
	 */
	goToPreviousStep(): NewProjectWizardStep {
		// If the current step is the only step and this function is called,
		// there is no previous step to go to.
		const currentStepIsFirstStep =
			this._steps.findIndex((step) => step === this._currentStep) === 0;
		if (currentStepIsFirstStep) {
			this._services.logService.error('[Project Wizard] No previous step to go to');
			return this._currentStep;
		}
		this._steps.pop();
		this._currentStep = this._steps[this._steps.length - 1];
		return this._currentStep;
	}
}
