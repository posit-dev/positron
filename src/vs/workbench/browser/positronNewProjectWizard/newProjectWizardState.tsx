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
 * NewProjectWizardServices interface.
 * Defines the set of services that are required by the New Project Wizard.
 */
interface NewProjectWizardServices {
	readonly commandService: ICommandService;
	readonly fileDialogService: IFileDialogService;
	readonly fileService: IFileService;
	readonly keybindingService: IKeybindingService;
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly logService: ILogService;
	readonly openerService: IOpenerService;
	readonly pathService: IPathService;
	readonly runtimeSessionService: IRuntimeSessionService;
	readonly runtimeStartupService: IRuntimeStartupService;
}

/**
 * NewProjectWizardStateConfig interface.
 * Defines the configuration to initialize the New Project Wizard state.
 */
export interface NewProjectWizardStateConfig {
	readonly services: NewProjectWizardServices;
	readonly parentFolder: string;
	readonly initialStep: NewProjectWizardStep;
	readonly steps?: NewProjectWizardStep[];
}

/**
 * NewProjectWizardState interface.
 * Used to keep track of the new project configuration in the New Project Wizard.
 */
export interface NewProjectWizardState {
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
 * INewProjectWizardStateManager interface.
 * Defines the state and state operations of the New Project Wizard.
 */
export interface INewProjectWizardStateManager {
	wizardState: NewProjectWizardState;
	goToNextStep: (step: NewProjectWizardStep) => void;
	goToPreviousStep: () => void;
}

/**
 * NewProjectWizardStateManager class.
 * This class is used to manage the state of the New Project Wizard.
 */
export class NewProjectWizardStateManager
	extends Disposable
	implements INewProjectWizardStateManager {
	private _services: NewProjectWizardServices;
	private _wizardState: NewProjectWizardState;
	private _steps: NewProjectWizardStep[];
	private _currentStep: NewProjectWizardStep;
	private _pythonEnvProviders: PythonEnvironmentProviderInfo[];

	/**
	 * Constructor for the NewProjectWizardStateManager class.
	 * @param config The NewProjectWizardStateConfig.
	 */
	constructor(config: NewProjectWizardStateConfig) {
		super();
		this._services = config.services;
		this._wizardState = {
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
			this._services.runtimeStartupService.onDidChangeRuntimeStartupPhase(
				async (phase) => {
					if (phase === RuntimeStartupPhase.Discovering) {
						// At this phase, the extensions that provide language runtimes will have been activated.
						this._pythonEnvProviders =
							(await this._services.commandService.executeCommand(
								'python.getCreateEnvironmentProviders'
							)) ?? [];
					}
				}
			)
		);
	}

	/**
	 * Gets the New Project Wizard state.
	 */
	get wizardState(): NewProjectWizardState {
		return this._wizardState;
	}

	/**
	 * Sets the New Project Wizard state.
	 */
	set wizardState(state: NewProjectWizardState) {
		this._wizardState = state;
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
		const stepAlreadyExists =
			this._steps.findIndex((s) => s === step) !== -1;
		if (stepAlreadyExists) {
			this._services.logService.error(
				'[Project Wizard] Step already exists'
			);
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
			this._services.logService.error(
				'[Project Wizard] No previous step to go to'
			);
			return this._currentStep;
		}
		this._steps.pop();
		this._currentStep = this._steps[this._steps.length - 1];
		return this._currentStep;
	}
}
