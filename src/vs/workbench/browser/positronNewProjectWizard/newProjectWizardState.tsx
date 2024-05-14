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
	getState: () => NewProjectWizardState;
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
	// Services used by the New Project Wizard.
	private _services: NewProjectWizardServices;

	// The state of the New Project Wizard.
	private _selectedRuntime: ILanguageRuntimeMetadata | undefined;
	private _projectType: NewProjectType | undefined;
	private _projectName: string;
	private _parentFolder: string;
	private _initGitRepo: boolean;
	private _openInNewWindow: boolean;
	// Python-specific state.
	private _pythonEnvSetupType: EnvironmentSetupType | undefined;
	private _pythonEnvProvider: string | undefined;
	private _installIpykernel: boolean | undefined;
	// R-specific state.
	private _useRenv: boolean | undefined;

	// The steps in the New Project Wizard.
	private _steps: NewProjectWizardStep[];
	private _currentStep: NewProjectWizardStep;

	// Dynamically populated data.
	private _pythonEnvProviders: PythonEnvironmentProviderInfo[];
	private _interpreters: ILanguageRuntimeMetadata[];

	/**
	 * Constructor for the NewProjectWizardStateManager class.
	 * @param config The NewProjectWizardStateConfig.
	 */
	constructor(config: NewProjectWizardStateConfig) {
		super();

		// Initialize the state.
		this._services = config.services;
		this._selectedRuntime = undefined;
		this._projectType = undefined;
		this._projectName = '';
		this._parentFolder = config.parentFolder ?? '';
		this._initGitRepo = false;
		this._openInNewWindow = false;
		this._pythonEnvSetupType = undefined;
		this._pythonEnvProvider = undefined;
		this._installIpykernel = undefined;
		this._useRenv = undefined;
		this._steps = config.steps ?? [config.initialStep];
		this._currentStep = config.initialStep;
		this._pythonEnvProviders = [];
		this._interpreters = [];

		// Register disposables.
		this._register(
			this._services.runtimeStartupService.onDidChangeRuntimeStartupPhase(
				async (phase) => {
					if (phase === RuntimeStartupPhase.Discovering) {
						// At this phase, the extensions that provide language runtimes will have been activated.
						this._pythonEnvProviders =
							(await this._services.commandService.executeCommand(
								'python.getCreateEnvironmentProviders'
							)) ?? [];
					} else if (phase === RuntimeStartupPhase.Complete) {
						this._interpreters =
							this._services.languageRuntimeService.registeredRuntimes;
					}
				}
			)
		);
	}

	/**
	 * Gets the selected runtime.
	 * @returns The selected runtime.
	 */
	get selectedRuntime(): ILanguageRuntimeMetadata | undefined {
		return this._selectedRuntime;
	}

	/**
	 * Sets the selected runtime.
	 * @param value The selected runtime.
	 */
	set selectedRuntime(value: ILanguageRuntimeMetadata | undefined) {
		this._selectedRuntime = value;
	}

	/**
	 * Gets the project type.
	 * @returns The project type.
	 */
	get projectType(): NewProjectType | undefined {
		return this._projectType;
	}

	/**
	 * Sets the project type.
	 * @param value The project type.
	 */
	set projectType(value: NewProjectType | undefined) {
		this._projectType = value;
	}

	/**
	 * Gets the project name.
	 * @returns The project name.
	 */
	get projectName(): string {
		return this._projectName;
	}

	/**
	 * Sets the project name.
	 * @param value The project name.
	 */
	set projectName(value: string) {
		this._projectName = value;
	}

	/**
	 * Gets the parent folder.
	 * @returns The parent folder.
	 */
	get parentFolder(): string {
		return this._parentFolder;
	}

	/**
	 * Sets the parent folder.
	 * @param value The parent folder.
	 */
	set parentFolder(value: string) {
		this._parentFolder = value;
	}

	/**
	 * Gets the initGitRepo flag.
	 * @returns The initGitRepo flag.
	 */
	get initGitRepo(): boolean {
		return this._initGitRepo;
	}

	/**
	 * Sets the initGitRepo flag.
	 * @param value Whether to initialize a Git repository.
	 */
	set initGitRepo(value: boolean) {
		this._initGitRepo = value;
	}

	/**
	 * Gets the openInNewWindow flag.
	 * @returns The openInNewWindow flag.
	 */
	get openInNewWindow(): boolean {
		return this._openInNewWindow;
	}

	/**
	 * Sets the openInNewWindow flag.
	 * @param value Whether to open the project in a new window.
	 */
	set openInNewWindow(value: boolean) {
		this._openInNewWindow = value;
	}

	/**
	 * Gets the Python environment setup type.
	 * @returns The Python environment setup type.
	 */
	get pythonEnvSetupType(): EnvironmentSetupType | undefined {
		return this._pythonEnvSetupType;
	}

	/**
	 * Sets the Python environment setup type.
	 * @param value The Python environment setup type.
	 */
	set pythonEnvSetupType(value: EnvironmentSetupType | undefined) {
		this._pythonEnvSetupType = value;
	}

	/**
	 * Gets the Python environment provider.
	 * @returns The Python environment provider.
	 */
	get pythonEnvProvider(): string | undefined {
		return this._pythonEnvProvider;
	}

	/**
	 * Sets the Python environment provider.
	 * @param value The Python environment provider.
	 */
	set pythonEnvProvider(value: string | undefined) {
		this._pythonEnvProvider = value;
	}

	/**
	 * Gets the installIpykernel flag.
	 * @returns The installIpykernel flag.
	 */
	get installIpykernel(): boolean | undefined {
		return this._installIpykernel;
	}

	/**
	 * Sets the installIpykernel flag.
	 * @param value Whether to install ipykernel.
	 */
	set installIpykernel(value: boolean | undefined) {
		this._installIpykernel = value;
	}

	/**
	 * Gets the useRenv flag.
	 * @returns The useRenv flag.
	 */
	get useRenv(): boolean | undefined {
		return this._useRenv;
	}

	/**
	 * Sets the useRenv flag.
	 * @param value Whether to use renv.
	 */
	set useRenv(value: boolean | undefined) {
		this._useRenv = value;
	}

	/**
	 * Gets the Python environment providers.
	 */
	get pythonEnvProviders(): PythonEnvironmentProviderInfo[] {
		return this._pythonEnvProviders;
	}

	/**
	 * Gets the interpreters.
	 */
	get interpreters(): ILanguageRuntimeMetadata[] {
		return this._interpreters;
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

	/**
	 * Gets the state of the New Project Wizard as a NewProjectWizardState object.
	 * @returns The NewProjectWizardState object.
	 */
	getState(): NewProjectWizardState {
		return {
			selectedRuntime: this._selectedRuntime,
			projectType: this._projectType,
			projectName: this._projectName,
			parentFolder: this._parentFolder,
			initGitRepo: this._initGitRepo,
			openInNewWindow: this._openInNewWindow,
			pythonEnvSetupType: this._pythonEnvSetupType,
			pythonEnvProvider: this._pythonEnvProvider,
			installIpykernel: this._installIpykernel,
			useRenv: this._useRenv
		} satisfies NewProjectWizardState;
	}
}
