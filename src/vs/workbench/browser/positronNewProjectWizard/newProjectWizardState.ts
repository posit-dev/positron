/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { IFileDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeStartupPhase } from '../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../services/runtimeStartup/common/runtimeStartupService.js';
import { EnvironmentSetupType, NewProjectWizardStep, PythonEnvironmentProvider } from './interfaces/newProjectWizardEnums.js';
import { IWorkbenchLayoutService } from '../../services/layout/browser/layoutService.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { IPathService } from '../../services/path/common/pathService.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { PythonEnvironmentProviderInfo } from './utilities/pythonEnvironmentStepUtils.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { WizardFormattedTextItem } from './components/wizardFormattedText.js';
import { LanguageIds, NewProjectType } from '../../services/positronNewProject/common/positronNewProject.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { CondaPythonVersionInfo, EMPTY_CONDA_PYTHON_VERSION_INFO } from './utilities/condaUtils.js';
import { URI } from '../../../base/common/uri.js';
import { ILabelService } from '../../../platform/label/common/label.js';

/**
 * NewProjectWizardServices interface.
 * Defines the set of services that are required by the New Project Wizard.
 */
interface NewProjectWizardServices {
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly fileDialogService: IFileDialogService;
	readonly fileService: IFileService;
	readonly keybindingService: IKeybindingService;
	readonly labelService: ILabelService;
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
	readonly parentFolder: URI;
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
	parentFolder: URI;
	initGitRepo: boolean;
	openInNewWindow: boolean;
	pythonEnvSetupType: EnvironmentSetupType | undefined;
	pythonEnvProviderId: string | undefined;
	condaPythonVersion: string | undefined;
	readonly pythonEnvProviderName: string | undefined;
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
	readonly onUpdateProjectDirectory: Event<void>;
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
	private _projectNameFeedback: WizardFormattedTextItem | undefined;
	private _parentFolder: URI;
	private _initGitRepo: boolean;
	private _openInNewWindow: boolean;
	// Python-specific state.
	private _pythonEnvSetupType: EnvironmentSetupType | undefined;
	private _pythonEnvProviderId: string | undefined;
	private _installIpykernel: boolean | undefined;
	private _minimumPythonVersion: string | undefined;
	private _condaPythonVersion: string | undefined;
	private _condaPythonVersionInfo: CondaPythonVersionInfo | undefined;
	private _isCondaInstalled: boolean | undefined;
	// R-specific state.
	private _useRenv: boolean | undefined;
	private _minimumRVersion: string | undefined;

	// The steps in the New Project Wizard.
	private _steps: NewProjectWizardStep[];
	private _currentStep: NewProjectWizardStep;

	// Dynamically populated data as the state changes.
	private _runtimeStartupComplete: boolean;
	private _pythonEnvProviders: PythonEnvironmentProviderInfo[] | undefined;
	private _interpreters: ILanguageRuntimeMetadata[] | undefined;
	private _preferredInterpreter: ILanguageRuntimeMetadata | undefined;

	// Event emitters.
	private _onUpdateInterpreterStateEmitter = this._register(new Emitter<void>());
	private _onUpdateProjectDirectoryEmitter = this._register(new Emitter<void>());

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
		this._projectNameFeedback = undefined;
		this._parentFolder = config.parentFolder ?? '';
		this._initGitRepo = false;
		// Default to a new window as the least "destructive" option.
		this._openInNewWindow = true;
		this._pythonEnvSetupType = EnvironmentSetupType.NewEnvironment;
		this._pythonEnvProviderId = undefined;
		this._installIpykernel = undefined;
		this._useRenv = undefined;
		this._steps = config.steps ?? [config.initialStep];
		this._currentStep = config.initialStep;
		this._pythonEnvProviders = undefined;
		this._interpreters = undefined;
		this._preferredInterpreter = undefined;
		this._runtimeStartupComplete = false;
		this._minimumPythonVersion = undefined;
		this._condaPythonVersionInfo = undefined;
		this._minimumRVersion = undefined;

		if (this._services.languageRuntimeService.startupPhase === RuntimeStartupPhase.Complete) {
			// If the runtime startup is already complete, initialize the wizard state and update
			// the interpreter-related state.
			this._initDefaultsFromExtensions()
				.then(() => {
					this._runtimeStartupComplete = true;
					this._updateInterpreterRelatedState();
				});
		} else {
			// Register disposables.
			this._register(
				this._services.languageRuntimeService.onDidChangeRuntimeStartupPhase(
					async (phase) => {
						if (phase === RuntimeStartupPhase.Discovering) {
							// At this phase, the extensions that provide language runtimes will
							// have been activated.
							await this._initDefaultsFromExtensions();
						} else if (phase === RuntimeStartupPhase.Complete) {
							await this._initDefaultsFromExtensions();
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

	//#region Getters & Setters

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
		this._updateInterpreterRelatedState();
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
		if (this._projectType !== value) {
			this._resetProjectConfig();
		}
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
		this._onUpdateProjectDirectoryEmitter.fire();
	}

	/**
	 * Gets the project name feedback.
	 * @returns The project name feedback.
	 */
	get projectNameFeedback(): WizardFormattedTextItem | undefined {
		return this._projectNameFeedback;
	}

	/**
	 * Sets the project name feedback.
	 * @param value The project name feedback.
	 */
	set projectNameFeedback(value: WizardFormattedTextItem | undefined) {
		this._projectNameFeedback = value;
		this._onUpdateProjectDirectoryEmitter.fire();
	}

	/**
	 * Gets the parent folder.
	 * @returns The parent folder.
	 */
	get parentFolder(): URI {
		return this._parentFolder;
	}

	/**
	 * Sets the parent folder.
	 * @param value The parent folder.
	 */
	set parentFolder(value: URI) {
		this._parentFolder = value;
		this._onUpdateProjectDirectoryEmitter.fire();
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
	 * Gets the Conda Python version.
	 * @returns The Conda Python version.
	 */
	get condaPythonVersion(): string | undefined {
		return this._condaPythonVersion;
	}

	/**
	 * Sets the Conda Python version.
	 * @param value The Conda Python version.
	 */
	set condaPythonVersion(value: string | undefined) {
		this._condaPythonVersion = value;
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
	 * @returns The Python environment providers.
	 */
	get pythonEnvProviders(): PythonEnvironmentProviderInfo[] | undefined {
		return this._pythonEnvProviders;
	}

	/**
	 * Gets the Conda Python version info.
	 * @returns The Conda Python version info.
	 */
	get condaPythonVersionInfo(): CondaPythonVersionInfo | undefined {
		return this._condaPythonVersionInfo;
	}

	/**
	 * Gets whether Conda is installed.
	 * @returns Whether Conda is installed.
	 */
	get isCondaInstalled(): boolean | undefined {
		return this._isCondaInstalled;
	}

	/**
	 * Gets whether the project uses a Conda environment.
	 * @returns Whether the project uses a Conda environment.
	 */
	get usesCondaEnv(): boolean {
		return this._usesCondaEnv();
	}

	/**
	 * Gets the interpreters.
	 * @returns The interpreters.
	 */
	get interpreters(): ILanguageRuntimeMetadata[] | undefined {
		return this._interpreters;
	}

	/**
	 * Gets the preferred interpreter.
	 * @returns The preferred interpreter.
	 */
	get preferredInterpreter(): ILanguageRuntimeMetadata | undefined {
		return this._preferredInterpreter;
	}

	/**
	 * Gets the current step in the New Project Wizard.
	 * @returns The current step.
	 */
	get currentStep(): NewProjectWizardStep {
		return this._currentStep;
	}

	/**
	 * Gets the services used by the New Project Wizard.
	 * @returns The services used by the New Project Wizard.
	 */
	get services(): NewProjectWizardServices {
		return this._services;
	}

	//#endregion Getters & Setters

	//#region Public Methods

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
		this._cleanupState();
		return {
			selectedRuntime: this._selectedRuntime,
			projectType: this._projectType,
			projectName: this._projectName,
			parentFolder: this._parentFolder,
			initGitRepo: this._initGitRepo,
			openInNewWindow: this._openInNewWindow,
			pythonEnvSetupType: this._pythonEnvSetupType,
			pythonEnvProviderId: this._pythonEnvProviderId,
			pythonEnvProviderName: this._getEnvProviderName(),
			installIpykernel: this._installIpykernel,
			condaPythonVersion: this._condaPythonVersion,
			useRenv: this._useRenv,
		} satisfies NewProjectWizardState;
	}

	/**
	 * Event that is fired when the runtime startup is complete.
	 */
	readonly onUpdateInterpreterState = this._onUpdateInterpreterStateEmitter.event;

	/**
	 * Event that is fired when the project directory is updated.
	 */
	readonly onUpdateProjectDirectory = this._onUpdateProjectDirectoryEmitter.event;

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Initializes some defaults provided by the extensions.
	 */
	private async _initDefaultsFromExtensions() {
		// Set the Python environment providers.
		if (!this.pythonEnvProviders?.length) {
			await this._setPythonEnvProviders();
		}

		// Set the minimum interpreter versions.
		const minVersionsToSet = [];
		if (!this._minimumPythonVersion) {
			minVersionsToSet.push(LanguageIds.Python);
		}
		if (!this._minimumRVersion) {
			minVersionsToSet.push(LanguageIds.R);
		}
		await this._setMinimumInterpreterVersions(minVersionsToSet);

		// Set the Conda Python versions.
		if (!this._condaPythonVersionInfo) {
			await this._setCondaPythonVersionInfo();
		}
	}

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

		// Update the interpreters list.
		this._interpreters = await this._getFilteredInterpreters();

		// Update the interpreter that should be selected in the dropdown.
		if (!this._selectedRuntime || !this._interpreters?.includes(this._selectedRuntime)) {
			this._resetSelectedRuntime();
		}

		// For Python projects, check if ipykernel needs to be installed.
		if (this._getLangId() === LanguageIds.Python) {
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
		if (!this._pythonEnvProviderId || !this._pythonEnvProviders) {
			return undefined;
		}
		return this._pythonEnvProviders.find(
			(provider) => provider.id === this._pythonEnvProviderId
		)?.name;
	}

	/**
	 * Checks if ipykernel needs to be installed for the selected Python interpreter.
	 * @returns A promise that resolves to true if ipykernel needs to be installed, false otherwise.
	 */
	private async _getInstallIpykernel(): Promise<boolean> {
		if (this._getLangId() !== LanguageIds.Python) {
			return false;
		}

		if (this._selectedRuntime) {
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
				'python.isIpykernelBundled',
				interpreterPath
			));
		}
		return false;
	}

	/**
	 * Sets the Python environment providers by calling the Python extension.
	 */
	private async _setPythonEnvProviders() {
		if (!this._pythonEnvProviders?.length) {
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
	 * Sets the Conda Python versions by calling the Python extension.
	 */
	private async _setCondaPythonVersionInfo() {
		this._condaPythonVersionInfo = EMPTY_CONDA_PYTHON_VERSION_INFO;

		if (!this._pythonEnvProviders?.length) {
			this._services.logService.error('[Project Wizard] No Python environment providers found.');
			return;
		}

		// Check if Conda is available as an environment provider.
		const providersIncludeConda = this._pythonEnvProviders.find(
			(provider) => provider.name === PythonEnvironmentProvider.Conda
		);
		if (!providersIncludeConda) {
			this._services.logService.info('[Project Wizard] Conda is not available as an environment provider.');
			return;
		}

		// Check if Conda is installed.
		this._isCondaInstalled = await this._services.commandService.executeCommand(
			'python.isCondaInstalled'
		);
		if (!this._isCondaInstalled) {
			this._services.logService.warn(
				'[Project Wizard] Conda is available as an environment provider, but it is not installed.'
			);
			return;
		}

		// Get the Conda Python versions.
		const pythonVersionInfo: CondaPythonVersionInfo | undefined =
			await this._services.commandService.executeCommand('python.getCondaPythonVersions');
		if (!pythonVersionInfo) {
			this._services.logService.warn('[Project Wizard] No Conda Python versions found.');
			return;
		}

		this._condaPythonVersionInfo = pythonVersionInfo;
		this._condaPythonVersion = this._condaPythonVersionInfo.preferred;
	}

	/**
	 * Determines if the project is using a Conda environment.
	 * @returns True if the project is using a Conda environment, false otherwise.
	 */
	private _usesCondaEnv(): boolean {
		return (
			this._getLangId() === LanguageIds.Python &&
			this._pythonEnvSetupType === EnvironmentSetupType.NewEnvironment &&
			this._getEnvProviderName() === PythonEnvironmentProvider.Conda
		);
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
	 * Retrieves the interpreters that match the current language ID and environment setup type if
	 * applicable.
	 * @returns The filtered interpreters sorted by runtime source, or undefined if runtime startup is
	 * not complete or a Conda environment is being used.
	 */
	private async _getFilteredInterpreters(): Promise<ILanguageRuntimeMetadata[] | undefined> {
		if (this._usesCondaEnv()) {
			this._services.logService.trace(`[Project Wizard] Conda environments do not have registered runtimes`);
			// Conda environments do not have registered runtimes. Instead, we have a list of Python
			// versions available for Conda environments, which is stored in condaPythonVersionInfo.
			return undefined;
		}

		// We don't want to return a partial list of interpreters if the runtime startup is not
		// complete, so we return undefined in that case.
		if (!this._runtimeStartupComplete) {
			this._services.logService.warn('[Project Wizard] Requested filtered interpreters before runtime startup is complete. Please come by later!');
			return undefined;
		}

		// Once the runtime startup is complete, we can return the filtered list of interpreters.
		const langId = this._getLangId();
		let runtimesForLang = this._services.languageRuntimeService.registeredRuntimes
			.filter(runtime => runtime.languageId === langId);

		// If we're creating a new Python environment, only return Global runtimes.
		if (langId === LanguageIds.Python
			&& this._pythonEnvSetupType === EnvironmentSetupType.NewEnvironment
		) {
			const globalRuntimes = [];
			for (const runtime of runtimesForLang) {
				const interpreterPath = runtime.extraRuntimeData.pythonPath as string ?? runtime.runtimePath;
				const isGlobal = await this.services.commandService.executeCommand(
					'python.isGlobalPython',
					interpreterPath
				) satisfies boolean | undefined;
				if (isGlobal === undefined) {
					this._services.logService.error(
						`[Project Wizard] Unable to determine if Python interpreter '${interpreterPath}' is global`
					);
					continue;
				}
				if (isGlobal) {
					globalRuntimes.push(runtime);
				} else {
					this._services.logService.trace(`[Project Wizard] Skipping non-global Python interpreter '${interpreterPath}'`);
				}
			}
			// If the global runtimes list is a different length than the original runtimes list,
			// then we only want to show the global runtimes.
			if (runtimesForLang.length !== globalRuntimes.length) {
				runtimesForLang = globalRuntimes;
			}
		}

		// Return the runtimes, sorted by runtime source.
		return runtimesForLang
			.sort((left, right) =>
				left.runtimeSource.localeCompare(right.runtimeSource)
			);
	}

	/**
	 * Resets the properties of the project configuration that should not be persisted when the
	 * project type changes.
	 */
	private _resetProjectConfig() {
		this._initGitRepo = false;
		this._useRenv = undefined;
		this.projectNameFeedback = undefined;
	}

	/**
	 * Cleans up the state by removing any irrelevant state based on the project language.
	 */
	private _cleanupState() {
		const langId = this._getLangId();
		if (!langId) {
			this._services.logService.error(
				'[Project Wizard] Unsupported project type'
			);
			return;
		}
		if (langId === LanguageIds.Python) {
			this._useRenv = undefined;
			const existingEnv =
				this._pythonEnvSetupType ===
				EnvironmentSetupType.ExistingEnvironment;
			if (existingEnv) {
				this._pythonEnvProviderId = undefined;
			}
			if (this._usesCondaEnv()) {
				this._selectedRuntime = undefined;
			} else {
				this._condaPythonVersion = undefined;
			}
		} else if (langId === LanguageIds.R) {
			this._pythonEnvSetupType = undefined;
			this._pythonEnvProviderId = undefined;
			this._installIpykernel = undefined;
			this._condaPythonVersion = undefined;
		}
	}

	//#endregion Private Methods
}
