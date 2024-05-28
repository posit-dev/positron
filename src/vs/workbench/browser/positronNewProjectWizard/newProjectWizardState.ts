/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService, RuntimeStartupPhase } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { EnvironmentSetupType, LanguageIds, NewProjectType, NewProjectWizardStep, PythonEnvironmentProvider, PythonRuntimeFilter } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILogService } from 'vs/platform/log/common/log';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IFileService } from 'vs/platform/files/common/files';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { PythonEnvironmentProviderInfo } from 'vs/workbench/browser/positronNewProjectWizard/utilities/pythonEnvironmentStepUtils';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';

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
	pythonEnvProviderId: string | undefined;
	readonly installIpykernel: boolean | undefined;
	useRenv: boolean | undefined;
}

/**
 * INewProjectWizardStateManager interface.
 * Defines the state and state operations of the New Project Wizard.
 */
export interface INewProjectWizardStateManager {
	readonly getState: () => NewProjectWizardState;
	readonly goToNextStep: (step: NewProjectWizardStep) => void;
	readonly goToPreviousStep: () => void;
	readonly onUpdateInterpreterState: Event<void>;
}

/**
 * RuntimeFilter type.
 * More filters can be added here as needed.
 */
type RuntimeFilter = PythonRuntimeFilter;

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
	private _pythonEnvProviderId: string | undefined;
	private _installIpykernel: boolean | undefined;
	private _minimumPythonVersion: string | undefined;
	// R-specific state.
	private _useRenv: boolean | undefined;
	private _minimumRVersion: string | undefined;

	// The steps in the New Project Wizard.
	private _steps: NewProjectWizardStep[];
	private _currentStep: NewProjectWizardStep;

	// Dynamically populated data as the state changes.
	private _runtimeStartupComplete: boolean;
	private _pythonEnvProviders: PythonEnvironmentProviderInfo[];
	private _interpreters: ILanguageRuntimeMetadata[] | undefined;
	private _preferredInterpreter: ILanguageRuntimeMetadata | undefined;

	// Event emitters.
	private _onUpdateInterpreterStateEmitter = this._register(new Emitter<void>());

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
		this._pythonEnvSetupType = EnvironmentSetupType.NewEnvironment;
		this._pythonEnvProviderId = undefined;
		this._installIpykernel = undefined;
		this._useRenv = undefined;
		this._steps = config.steps ?? [config.initialStep];
		this._currentStep = config.initialStep;
		this._pythonEnvProviders = [];
		this._interpreters = undefined;
		this._preferredInterpreter = undefined;
		this._runtimeStartupComplete = false;
		this._minimumPythonVersion = undefined;
		this._minimumRVersion = undefined;

		if (this._services.runtimeStartupService.startupPhase === RuntimeStartupPhase.Complete) {
			// If the runtime startup is already complete, set the Python environment providers and
			// update the interpreter-related state.
			this._setPythonEnvProviders()
				.then(() => this._setMinimumInterpreterVersions())
				.then(() => {
					this._runtimeStartupComplete = true;
					this._updateInterpreterRelatedState();
				}
				);
		} else {
			// Register disposables.
			this._register(
				this._services.runtimeStartupService.onDidChangeRuntimeStartupPhase(
					async (phase) => {
						if (phase === RuntimeStartupPhase.Discovering) {
							// At this phase, the extensions that provide language runtimes will
							// have been activated.
							await this._setPythonEnvProviders();
							await this._setMinimumInterpreterVersions();
						} else if (phase === RuntimeStartupPhase.Complete) {
							if (!this._pythonEnvProviders.length) {
								// In case the runtime startup phase is complete and the providers
								// are not set, set the providers.
								await this._setPythonEnvProviders();
							}
							if (!this._minimumPythonVersion) {
								// In case the runtime startup phase is complete and the minimum
								// Python version is not set, set the minimum Python version.
								await this._setMinimumInterpreterVersions([LanguageIds.Python]);
							}
							if (!this._minimumRVersion) {
								// In case the runtime startup phase is complete and the minimum
								// R version is not set, set the minimum R version.
								await this._setMinimumInterpreterVersions([LanguageIds.R]);
							}
							this._runtimeStartupComplete = true;
							// Once the runtime startup is complete, we can update the
							// interpreter-related state.
							await this._updateInterpreterRelatedState();
						}
					}
				)
			);
		}
	}

	/****************************************************************************************
	 * Getters & Setters
	 ****************************************************************************************/

	/**
	 * Gets the selected runtime.
	 * @returns The selected runtime.
	 */
	get selectedRuntime(): ILanguageRuntimeMetadata | undefined {
		// If the selected runtime is set, return it.
		if (this._selectedRuntime) {
			return this._selectedRuntime;
		}

		// If the selected runtime is not set, request that the selected runtime be reset and
		// return the updated selected runtime.
		this._resetSelectedRuntime();
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
		this._updateInterpreterRelatedState();
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
	 * Sets the Python environment setup type. Triggers an update of the interpreter-related state.
	 * @param value The Python environment setup type.
	 * If the environment setup type is set to ExistingEnvironment, the provider is cleared as it is
	 * only relevant for new environments.
	 */
	set pythonEnvSetupType(value: EnvironmentSetupType | undefined) {
		this._pythonEnvSetupType = value;
		this._updateInterpreterRelatedState();
	}

	/**
	 * Gets the Python environment provider.
	 * @returns The Python environment provider.
	 */
	get pythonEnvProvider(): string | undefined {
		return this._pythonEnvProviderId;
	}

	/**
	 * Sets the Python environment provider. Trigger an update of the interpreter-related state.
	 * @param value The Python environment provider.
	 */
	set pythonEnvProvider(value: string | undefined) {
		this._pythonEnvProviderId = value;
		this._updateInterpreterRelatedState();
	}

	/**
	 * Gets the installIpykernel flag.
	 * @returns The installIpykernel flag.
	 */
	get installIpykernel(): boolean | undefined {
		return this._installIpykernel;
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
	 * Gets the minimum Python version.
	 * @returns The minimum Python version.
	 */
	get minimumPythonVersion(): string | undefined {
		return this._minimumPythonVersion;
	}

	/**
	 * Gets the minimum R version.
	 * @returns The minimum R version.
	 */
	get minimumRVersion(): string | undefined {
		return this._minimumRVersion;
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
	get interpreters(): ILanguageRuntimeMetadata[] | undefined {
		return this._interpreters;
	}

	/**
	 * Gets the preferred interpreter.
	 */
	get preferredInterpreter(): ILanguageRuntimeMetadata | undefined {
		return this._preferredInterpreter;
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

	/****************************************************************************************
	 * Public Methods
	 ****************************************************************************************/

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
			pythonEnvProviderId: this._pythonEnvProviderId,
			installIpykernel: this._installIpykernel,
			useRenv: this._useRenv
		} satisfies NewProjectWizardState;
	}

	/**
	 * Event that is fired when the runtime startup is complete.
	 */
	readonly onUpdateInterpreterState = this._onUpdateInterpreterStateEmitter.event;

	/****************************************************************************************
	 * Private Methods
	 ****************************************************************************************/

	/**
	 * Updates the interpreter-related state such as the interpreters list, the selected interpreter,
	 * and the installIpykernel flag.
	 * @returns A promise that resolves when the interpreter-related state has been updated.
	 */
	private async _updateInterpreterRelatedState(): Promise<void> {
		// If this is called before the runtime startup is complete, do nothing, since we won't yet
		// have the full interpreters list.
		if (!this._runtimeStartupComplete) {
			return;
		}

		const langId = this._getLangId();
		let runtimeSourceFilters: RuntimeFilter[] | undefined = undefined;

		// Add runtime filters for new Venv Python environments.
		if (langId === LanguageIds.Python && this._pythonEnvSetupType === EnvironmentSetupType.NewEnvironment) {
			if (this._getEnvProviderName() === PythonEnvironmentProvider.Venv) {
				runtimeSourceFilters = [PythonRuntimeFilter.Global, PythonRuntimeFilter.Pyenv];
			}
		}

		// Update the interpreters list.
		this._interpreters = this._getFilteredInterpreters(runtimeSourceFilters);

		// Update the interpreter that should be selected in the dropdown.
		if (!this._selectedRuntime || !this._interpreters?.includes(this._selectedRuntime)) {
			this._resetSelectedRuntime();
		}

		// For Python projects, check if ipykernel needs to be installed.
		if (langId === LanguageIds.Python) {
			this._installIpykernel = await this._getInstallIpykernel();
		}

		// Notify components that the interpreter state has been updated.
		this._onUpdateInterpreterStateEmitter.fire();
	}

	/**
	 * Resets the selected runtime by setting it to the preferred runtime for the language or the
	 * first runtime in the interpreters list. If the preferred runtime is available in the
	 * interpreters list, it is set as the selected runtime and the preferred interpreter.
	 */
	private _resetSelectedRuntime(): void {
		// If the interpreters list is not set or is empty, the selected runtime cannot be set.
		if (!this._interpreters?.length) {
			return;
		}

		// Try to get the preferred runtime for the language.
		const langId = this._getLangId();
		if (!langId) {
			return;
		}
		const preferredRuntime = this._services.runtimeStartupService.getPreferredRuntime(langId);
		if (this._interpreters.includes(preferredRuntime)) {
			this._selectedRuntime = preferredRuntime;
			this._preferredInterpreter = preferredRuntime;
			return;
		}

		// If the preferred runtime is not in the interpreters list, use the first runtime in the
		// interpreters list.
		if (this._interpreters.length) {
			this._selectedRuntime = this._interpreters[0];
			return;
		}
	}

	/**
	 * Gets the language ID based on the project type.
	 * @returns The language ID or undefined for an unsupported project type.
	 */
	private _getLangId(): LanguageIds | undefined {
		return this._projectType === NewProjectType.PythonProject ||
			this._projectType === NewProjectType.JupyterNotebook
			? LanguageIds.Python
			: this.projectType === NewProjectType.RProject
				? LanguageIds.R
				: undefined;
	}

	/**
	 * Gets the name of the selected Python environment provider.
	 * @returns The name of the selected Python environment provider.
	 */
	private _getEnvProviderName(): string | undefined {
		return this._pythonEnvProviders.find(provider => provider.id === this._pythonEnvProviderId)?.name;
	}

	/**
	 * Checks if ipykernel needs to be installed for the selected Python interpreter.
	 * @returns A promise that resolves to true if ipykernel needs to be installed, false otherwise.
	 */
	private async _getInstallIpykernel(): Promise<boolean> {
		if (this._getLangId() !== LanguageIds.Python) {
			return false;
		}

		if (this._pythonEnvSetupType === EnvironmentSetupType.NewEnvironment) {
			// ipykernel will always be installed for new environments.
			return true;
		} else if (this._selectedRuntime) {
			// When using an aliased runtimePath (starts with `~`) such as ~/myEnv/python instead of
			// a non-aliased path like /home/sharon/myEnv/python or /usr/bin/python, the ipykernel
			// version check errors, although the non-aliased pythonPath works fine.
			// In many cases, the pythonPath and runtimePath are the same. When they differ, it
			// seems that the pythonPath is the non-aliased runtimePath to the python interpreter.
			// From some brief debugging, it looks like many Conda, Pyenv and Venv environments have
			// aliased runtimePaths.
			const interpreterPath =
				this._selectedRuntime.extraRuntimeData?.pythonPath ??
				this._selectedRuntime.runtimePath;
			return !(await this.services.commandService.executeCommand(
				'python.isIpykernelInstalled',
				interpreterPath
			));
		}
		return false;
	}

	/**
	 * Sets the Python environment providers by calling the Python extension.
	 */
	private async _setPythonEnvProviders() {
		if (!this._pythonEnvProviders.length) {
			this._pythonEnvProviders =
				(await this._services.commandService.executeCommand(
					'python.getCreateEnvironmentProviders'
				)) ?? [];
		}

		if (!this._pythonEnvProviderId) {
			// TODO: in the future, we may want to use the user's preferred environment type.
			this._pythonEnvProviderId = this._pythonEnvProviders[0]?.id;
		}

		// Notify components that the interpreter state has been updated.
		this._onUpdateInterpreterStateEmitter.fire();
	}

	/**
	 * Gets the minimum supported version for the selected language.
	 * @param langIds Optional language IDs to set the minimum version for.
	 * @returns The minimum supported version or undefined if the language is not supported.
	 */
	private async _setMinimumInterpreterVersions(langIds?: LanguageIds[]): Promise<void> {
		const langsForMinimumVersions = langIds ?? [LanguageIds.Python, LanguageIds.R];
		if (langsForMinimumVersions.includes(LanguageIds.Python)) {
			this._minimumPythonVersion = await this._services.commandService.executeCommand(
				'python.getMinimumPythonVersion'
			);
		}
		if (langsForMinimumVersions.includes(LanguageIds.R)) {
			this._minimumRVersion = await this._services.commandService.executeCommand(
				'r.getMinimumRVersion'
			);
		}
	}

	/**
	 * Retrieves the interpreters that match the language ID and runtime source filters. Sorts the
	 * interpreters by runtime source.
	 * @param runtimeSourceFilters Optional runtime source filters to apply.
	 * @returns The filtered interpreters.
	 */
	private _getFilteredInterpreters(runtimeSourceFilters?: RuntimeFilter[]): ILanguageRuntimeMetadata[] | undefined {
		const langId = this._getLangId();

		if (
			langId === LanguageIds.Python &&
			this._pythonEnvSetupType === EnvironmentSetupType.NewEnvironment &&
			this._getEnvProviderName() === PythonEnvironmentProvider.Conda
		) {
			// TODO: we should get the list of Python versions from the Conda service. Currently, we
			// hardcode the list of Python versions in the
			// src/vs/workbench/browser/positronNewProjectWizard/utilities/interpreterDropDownUtils.ts
			// interpretersToDropdownItems function.
			return [];
		}

		// We don't want to return a partial list of interpreters if the runtime startup is not
		// complete, so we return undefined in that case.
		if (!this._runtimeStartupComplete) {
			return undefined;
		}

		// Once the runtime startup is complete, we can return the filtered list of interpreters.
		return this._services.languageRuntimeService.registeredRuntimes
			// Filter by language ID and runtime source.
			.filter(
				(runtime) =>
					runtime.languageId === langId &&
					this._includeRuntimeSource(runtime.runtimeSource, runtimeSourceFilters)
			)
			// Sort by runtime source.
			.sort((left, right) =>
				left.runtimeSource.localeCompare(right.runtimeSource)
			);
	}

	/**
	 * Determines if the runtime source should be included based on the filters.
	 * @param runtimeSource The runtime source to check.
	 * @param filters The runtime source filters to apply.
	 * @returns True if the runtime source should be included, false otherwise.
	 * If no filters are provided, all runtime sources are included.
	 */
	private _includeRuntimeSource(
		runtimeSource: string,
		filters?: RuntimeFilter[]
	) {
		return (
			!filters ||
			!filters.length ||
			filters.find((rs) => rs === runtimeSource) !== undefined
		);
	}
}
