/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { ILanguageRuntimeMetadata, LanguageStartupBehavior, RuntimeStartupPhase } from '../../services/languageRuntime/common/languageRuntimeService.js';
import { EnvironmentSetupType, NewFolderFlowStep, PythonEnvironmentProvider } from './interfaces/newFolderFlowEnums.js';
import { PythonEnvironmentProviderInfo } from './utilities/pythonEnvironmentStepUtils.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { FlowFormattedTextItem } from './components/flowFormattedText.js';
import { LanguageIds, FolderTemplate } from '../../services/positronNewFolder/common/positronNewFolder.js';
import { CondaPythonVersionInfo, EMPTY_CONDA_PYTHON_VERSION_INFO } from './utilities/condaUtils.js';
import { UvPythonVersionInfo, EMPTY_UV_PYTHON_VERSION_INFO } from './utilities/uvUtils.js';
import { URI } from '../../../base/common/uri.js';
import { PositronReactServices } from '../../../base/browser/positronReactServices.js';

/**
 * NewFolderFlowStateConfig interface.
 * Defines the configuration to initialize the New Folder Flow state.
 */
export interface NewFolderFlowStateConfig {
	readonly parentFolder: URI;
	readonly initialStep: NewFolderFlowStep;
	readonly steps?: NewFolderFlowStep[];
}

/**
 * NewFolderFlowState interface.
 * Used to keep track of the new folder configuration in the New Folder Flow.
 */
export interface NewFolderFlowState {
	selectedRuntime: ILanguageRuntimeMetadata | undefined;
	folderTemplate: FolderTemplate | undefined;
	folderName: string;
	parentFolder: URI;
	initGitRepo: boolean;
	openInNewWindow: boolean;
	createPyprojectToml: boolean | undefined;
	pythonEnvSetupType: EnvironmentSetupType | undefined;
	pythonEnvProviderId: string | undefined;
	condaPythonVersion: string | undefined;
	uvPythonVersion: string | undefined;
	readonly pythonEnvProviderName: string | undefined;
	readonly installIpykernel: boolean | undefined;
	useRenv: boolean | undefined;
}

/**
 * INewFolderFlowStateManager interface.
 * Defines the state and state operations of the New Folder Flow.
 */
export interface INewFolderFlowStateManager {
	readonly getState: () => NewFolderFlowState;
	readonly goToNextStep: (step: NewFolderFlowStep) => void;
	readonly goToPreviousStep: () => void;
	readonly onUpdateInterpreterState: Event<void>;
	readonly onUpdateFolderPath: Event<void>;
}

/**
 * NewFolderFlowStateManager class.
 * This class is used to manage the state of the New Folder Flow.
 */
export class NewFolderFlowStateManager
	extends Disposable
	implements INewFolderFlowStateManager {
	// Services used by the New Folder Flow.
	private _services: PositronReactServices;

	// The state of the New Folder Flow.
	private _selectedRuntime: ILanguageRuntimeMetadata | undefined;
	private _availableFolderTemplates: FolderTemplate[];
	private _folderTemplate: FolderTemplate | undefined;
	private _folderName: string;
	private _folderNameFeedback: FlowFormattedTextItem | undefined;
	private _parentFolder: URI;
	private _initGitRepo: boolean;
	private _openInNewWindow: boolean;

	// Python-specific state.
	private _pythonEnvSetupType: EnvironmentSetupType | undefined;
	private _pythonEnvProviderId: string | undefined;
	private _installIpykernel: boolean | undefined;
	private _createPyprojectToml: boolean | undefined;
	private _minimumPythonVersion: string | undefined;
	private _condaPythonVersion: string | undefined;
	private _condaPythonVersionInfo: CondaPythonVersionInfo | undefined;
	private _isCondaInstalled: boolean | undefined;
	private _uvPythonVersion: string | undefined;
	private _uvPythonVersionInfo: UvPythonVersionInfo | undefined;
	private _isUvInstalled: boolean | undefined;

	// R-specific state.
	private _useRenv: boolean | undefined;
	private _minimumRVersion: string | undefined;

	// The steps in the New Folder Flow.
	private _steps: NewFolderFlowStep[];
	private _currentStep: NewFolderFlowStep;

	// Dynamically populated data as the state changes.
	private _runtimeStartupComplete: boolean;
	private _pythonEnvProviders: PythonEnvironmentProviderInfo[] | undefined;
	private _interpreters: ILanguageRuntimeMetadata[] | undefined;
	private _preferredInterpreter: ILanguageRuntimeMetadata | undefined;

	// Event emitters.
	private _onUpdateInterpreterStateEmitter = this._register(new Emitter<void>());
	private _onUpdateFolderPathEmitter = this._register(new Emitter<void>());

	/**
	 * Constructor for the NewFolderFlowStateManager class.
	 * @param config The NewFolderFlowStateConfig.
	 */
	constructor(config: NewFolderFlowStateConfig) {
		super();

		// Initialize the state.
		this._services = PositronReactServices.services;
		this._selectedRuntime = undefined;
		this._availableFolderTemplates = this._getAvailableFolderTemplates();
		this._folderTemplate = undefined;
		this._folderName = '';
		this._folderNameFeedback = undefined;
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
		this._createPyprojectToml = undefined;
		this._pythonEnvProviders = undefined;
		this._interpreters = undefined;
		this._preferredInterpreter = undefined;
		this._runtimeStartupComplete = false;
		this._minimumPythonVersion = undefined;
		this._condaPythonVersionInfo = undefined;
		this._uvPythonVersionInfo = undefined;
		this._minimumRVersion = undefined;

		if (this._services.languageRuntimeService.startupPhase === RuntimeStartupPhase.Complete) {
			// If the runtime startup is already complete, initialize the flow state and update
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
	 * Gets the available folder templates.
	 */
	get availableFolderTemplates(): FolderTemplate[] {
		return this._availableFolderTemplates;
	}

	/**
	 * Gets the folder template.
	 * @returns The folder template.
	 */
	get folderTemplate(): FolderTemplate | undefined {
		return this._folderTemplate;
	}

	/**
	 * Sets the folder template.
	 * @param folderTemplate The folder template.
	 */
	set folderTemplate(folderTemplate: FolderTemplate | undefined) {
		if (this._folderTemplate !== folderTemplate) {
			this._resetFolderConfig();
		}
		if (folderTemplate === FolderTemplate.PythonProject) {
			// Defaults to true for Python projects only.
			this.createPyprojectToml = true;
		}
		this._folderTemplate = folderTemplate;
		this._updateInterpreterRelatedState();
	}

	/**
	 * Gets the folder name.
	 * @returns The folder name.
	 */
	get folderName(): string {
		return this._folderName;
	}

	/**
	 * Sets the folder name.
	 * @param value The folder name.
	 */
	set folderName(value: string) {
		this._folderName = value;
		this._onUpdateFolderPathEmitter.fire();
	}

	/**
	 * Gets the folder name feedback.
	 * @returns The folder name feedback.
	 */
	get folderNameFeedback(): FlowFormattedTextItem | undefined {
		return this._folderNameFeedback;
	}

	/**
	 * Sets the folder name feedback.
	 * @param value The folder name feedback.
	 */
	set folderNameFeedback(value: FlowFormattedTextItem | undefined) {
		this._folderNameFeedback = value;
		this._onUpdateFolderPathEmitter.fire();
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
		this._onUpdateFolderPathEmitter.fire();
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
	 * Gets the createPyprojectToml flag.
	 * @returns The createPyprojectToml flag.
	 */
	get createPyprojectToml(): boolean | undefined {
		return this._createPyprojectToml;
	}

	/**
	 * Sets the createPyprojectToml flag.
	 * @param value Whether to create a pyproject.toml file.
	 */
	set createPyprojectToml(value: boolean | undefined) {
		this._createPyprojectToml = value;
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
	 * @param value Whether to open the folder in a new window.
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
	 * Gets the uv Python version.
	 * @returns The uv Python version.
	 */
	get uvPythonVersion(): string | undefined {
		return this._uvPythonVersion;
	}

	/**
	 * Sets the uv Python version.
	 * @param value The uv Python version.
	 */
	set uvPythonVersion(value: string | undefined) {
		this._uvPythonVersion = value;
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
	 * Gets the uv Python version info.
	 * @returns The uv Python version info.
	 */
	get uvPythonVersionInfo(): UvPythonVersionInfo | undefined {
		return this._uvPythonVersionInfo;
	}

	/**
	 * Gets whether Conda is installed.
	 * @returns Whether Conda is installed.
	 */
	get isCondaInstalled(): boolean | undefined {
		return this._isCondaInstalled;
	}

	/**
	 * Gets whether uv is installed.
	 * @returns Whether uv is installed.
	 */
	get isUvInstalled(): boolean | undefined {
		return this._isUvInstalled;
	}

	/**
	 * Gets whether the folder uses a Conda environment.
	 * @returns Whether the folder uses a Conda environment.
	 */
	get usesCondaEnv(): boolean {
		return this._usesCondaEnv();
	}

	/**
	 * Gets whether the folder uses a uv environment.
	 * @returns Whether the folder uses a uv environment.
	 */
	get usesUvEnv(): boolean {
		return this._usesUvEnv();
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
	 * Gets the current step in the New Folder Flow.
	 * @returns The current step.
	 */
	get currentStep(): NewFolderFlowStep {
		return this._currentStep;
	}

	/**
	 * Gets the services used by the New Folder Flow.
	 * @returns The services used by the New Folder Flow.
	 */
	get services(): PositronReactServices {
		return this._services;
	}

	//#endregion Getters & Setters

	//#region Public Methods

	/**
	 * Sets the provided next step as the current step in the New Folder Flow.
	 * Go to the next step by pushing the next step onto the stack of steps,
	 * and setting the new current step to the next step.
	 * @param step The step to go to.
	 * @returns The next step.
	 */
	goToNextStep(step: NewFolderFlowStep): NewFolderFlowStep {
		// If the step already exists in the stack, don't add it again. Although the
		// steps are not expected to be repeated, this check prevents us from adding
		// the same step multiple times.
		const stepAlreadyExists =
			this._steps.findIndex((s) => s === step) !== -1;
		if (stepAlreadyExists) {
			this._services.logService.error(
				'[New Folder Flow] Step already exists'
			);
			return this._currentStep;
		}
		this._steps.push(step);
		this._currentStep = step;
		return this._currentStep;
	}

	/**
	 * Retrieves the previous step in the New Folder Flow and sets it as the current step.
	 * Go to the previous step by popping the current step off the stack,
	 * and setting the new current step to the previous step.
	 * @returns The previous step.
	 */
	goToPreviousStep(): NewFolderFlowStep {
		// If the current step is the only step and this function is called,
		// there is no previous step to go to.
		const currentStepIsFirstStep =
			this._steps.findIndex((step) => step === this._currentStep) === 0;
		if (currentStepIsFirstStep) {
			this._services.logService.error(
				'[New Folder Flow] No previous step to go to'
			);
			return this._currentStep;
		}
		this._steps.pop();
		this._currentStep = this._steps[this._steps.length - 1];
		return this._currentStep;
	}

	/**
	 * Gets the state of the New Folder Flow as a NewFolderFlowState object.
	 * @returns The NewFolderFlowState object.
	 */
	getState(): NewFolderFlowState {
		this._cleanupConfigureState();
		return {
			selectedRuntime: this._selectedRuntime,
			folderTemplate: this._folderTemplate,
			folderName: this._folderName,
			parentFolder: this._parentFolder,
			initGitRepo: this._initGitRepo,
			openInNewWindow: this._openInNewWindow,
			pythonEnvSetupType: this._pythonEnvSetupType,
			pythonEnvProviderId: this._pythonEnvProviderId,
			pythonEnvProviderName: this._getEnvProviderName(),
			installIpykernel: this._installIpykernel,
			createPyprojectToml: this._createPyprojectToml,
			condaPythonVersion: this._condaPythonVersion,
			uvPythonVersion: this._uvPythonVersion,
			useRenv: this._useRenv,
		} satisfies NewFolderFlowState;
	}

	/**
	 * Event that is fired when the runtime startup is complete.
	 */
	readonly onUpdateInterpreterState = this._onUpdateInterpreterStateEmitter.event;

	/**
	 * Event that is fired when the folder path is updated.
	 */
	readonly onUpdateFolderPath = this._onUpdateFolderPathEmitter.event;

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

		// Set the uv Python versions.
		if (!this._uvPythonVersionInfo) {
			await this._setUvPythonVersionInfo();
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

		// For Python folder, check if ipykernel needs to be installed.
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
		if (preferredRuntime) {
			if (this._interpreters.includes(preferredRuntime)) {
				this._selectedRuntime = preferredRuntime;
				this._preferredInterpreter = preferredRuntime;
				return;
			}
		}

		// If the preferred runtime is not in the interpreters list, use the first runtime in the
		// interpreters list.
		if (this._interpreters.length) {
			this._selectedRuntime = this._interpreters[0];
			return;
		}
	}

	/**
	 * Constructs and returns the list of available folder templates, with folder templates filtered
	 * on the current configuration settings for interpreter startup behavior.
	 * @returns The list of available folder templates.
	 */
	private _getAvailableFolderTemplates(): FolderTemplate[] {
		const generalStartupBehavior = this.services.configurationService.getValue('interpreters.startupBehavior');
		const pythonStartupBehavior = this.services.configurationService.getValue('interpreters.startupBehavior', { overrideIdentifier: LanguageIds.Python });
		const rStartupBehavior = this.services.configurationService.getValue('interpreters.startupBehavior', { overrideIdentifier: LanguageIds.R });

		return Object.values(FolderTemplate).filter((template) => {
			// Always include the Empty Project template, as it does not require any interpreter startup.
			if (template === FolderTemplate.EmptyProject) {
				return true;
			}

			// If interpreter startup is disabled altogether, do not include any templates that require interpreter startup.
			if (generalStartupBehavior === LanguageStartupBehavior.Disabled) {
				return false;
			}

			// Include the Python and Jupyter templates only if the Python startup behavior is not disabled.
			if (template === FolderTemplate.PythonProject || template === FolderTemplate.JupyterNotebook) {
				return pythonStartupBehavior !== LanguageStartupBehavior.Disabled;
			}

			// Include the R template only if the R startup behavior is not disabled.
			if (template === FolderTemplate.RProject) {
				return rStartupBehavior !== LanguageStartupBehavior.Disabled;
			}

			// Otherwise, include the template!
			return true;
		});
	}

	/**
	 * Gets the language ID based on the folder template.
	 * @returns The language ID or undefined for an unsupported folder template.
	 */
	private _getLangId(): LanguageIds | undefined {
		return this._folderTemplate === FolderTemplate.PythonProject ||
			this._folderTemplate === FolderTemplate.JupyterNotebook
			? LanguageIds.Python
			: this.folderTemplate === FolderTemplate.RProject
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
			this._services.logService.error('[New Folder Flow] No Python environment providers found.');
			return;
		}

		// Check if Conda is available as an environment provider.
		const providersIncludeConda = this._pythonEnvProviders.find(
			(provider) => provider.name === PythonEnvironmentProvider.Conda
		);
		if (!providersIncludeConda) {
			this._services.logService.info('[New Folder Flow] Conda is not available as an environment provider.');
			return;
		}

		// Check if Conda is installed.
		this._isCondaInstalled = await this._services.commandService.executeCommand(
			'python.isCondaInstalled'
		);
		if (!this._isCondaInstalled) {
			this._services.logService.warn(
				'[New Folder Flow] Conda is available as an environment provider, but it is not installed.'
			);
			return;
		}

		// Get the Conda Python versions.
		const pythonVersionInfo: CondaPythonVersionInfo | undefined =
			await this._services.commandService.executeCommand('python.getCondaPythonVersions');
		if (!pythonVersionInfo) {
			this._services.logService.warn('[New Folder Flow] No Conda Python versions found.');
			return;
		}

		this._condaPythonVersionInfo = pythonVersionInfo;
		this._condaPythonVersion = this._condaPythonVersionInfo.preferred;
	}

	/**
	 * Sets the uv Python versions by calling the Python extension.
	 */
	private async _setUvPythonVersionInfo() {
		this._uvPythonVersionInfo = EMPTY_UV_PYTHON_VERSION_INFO;

		if (!this._pythonEnvProviders?.length) {
			this._services.logService.error('[New Folder Flow] No Python environment providers found.');
			return;
		}

		// Check if uv is available as an environment provider.
		const providersIncludeUv = this._pythonEnvProviders.find(
			(provider) => provider.name === PythonEnvironmentProvider.Uv
		);
		if (!providersIncludeUv) {
			this._services.logService.info('[New Folder Flow] uv is not available as an environment provider.');
			return;
		}

		// Check if uv is installed.
		this._isUvInstalled = await this._services.commandService.executeCommand(
			'python.isUvInstalled'
		);
		if (!this._isUvInstalled) {
			this._services.logService.warn(
				'[New Folder Flow] uv is available as an environment provider, but it is not installed.'
			);
			return;
		}

		// Get the uv Python versions.
		const pythonVersionInfo: UvPythonVersionInfo | undefined =
			await this._services.commandService.executeCommand('python.getUvPythonVersions');
		if (!pythonVersionInfo) {
			this._services.logService.warn('[New Folder Flow] No uv Python versions found.');
			return;
		}

		this._uvPythonVersionInfo = pythonVersionInfo;
		this._uvPythonVersion = this._uvPythonVersionInfo.versions[0];
	}

	/**
	 * Determines if the folder is using a Conda environment.
	 * @returns True if the folder is using a Conda environment, false otherwise.
	 */
	private _usesCondaEnv(): boolean {
		return (
			this._getLangId() === LanguageIds.Python &&
			this._pythonEnvSetupType === EnvironmentSetupType.NewEnvironment &&
			this._getEnvProviderName() === PythonEnvironmentProvider.Conda
		);
	}

	/**
	 * Determines if the folder is using a uv environment.
	 * @returns True if the folder is using a uv environment, false otherwise.
	 */
	private _usesUvEnv(): boolean {
		return (
			this._getLangId() === LanguageIds.Python &&
			this._pythonEnvSetupType === EnvironmentSetupType.NewEnvironment &&
			this._getEnvProviderName() === PythonEnvironmentProvider.Uv
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
	 * not complete or a Conda or uv environment is being used.
	 */
	private async _getFilteredInterpreters(): Promise<ILanguageRuntimeMetadata[] | undefined> {
		if (this._usesCondaEnv() || this._usesUvEnv()) {
			this._services.logService.trace(`[New Folder Flow] Conda or uv environments do not have registered runtimes`);
			// Conda and uv environments do not have registered runtimes. Instead, we have a list of Python
			// versions available for these environments, which is stored in their respective versionInfo.
			return undefined;
		}

		// We don't want to return a partial list of interpreters if the runtime startup is not
		// complete, so we return undefined in that case.
		if (!this._runtimeStartupComplete) {
			this._services.logService.warn('[New Folder Flow] Requested filtered interpreters before runtime startup is complete. Please come by later!');
			return undefined;
		}

		// Once the runtime startup is complete, we can return the filtered list of interpreters.
		const langId = this._getLangId();
		let runtimesForLang = this._services.languageRuntimeService.registeredRuntimes
			.filter(runtime => runtime.languageId === langId)
			.filter(runtime => runtime.extraRuntimeData?.supported ?? true);

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
						`[New Folder Flow] Unable to determine if Python interpreter '${interpreterPath}' is global`
					);
					continue;
				}
				if (isGlobal) {
					globalRuntimes.push(runtime);
				} else {
					this._services.logService.trace(`[New Folder Flow] Skipping non-global Python interpreter '${interpreterPath}'`);
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
	 * Resets the properties of the folder configuration that should not be persisted when the
	 * folder template changes.
	 */
	private _resetFolderConfig() {
		this._initGitRepo = false;
		this._createPyprojectToml = undefined;
		this._useRenv = undefined;
		this.folderNameFeedback = undefined;
	}

	/**
	 * Cleans up and configures the state based on the folder language.
	 */
	private _cleanupConfigureState() {
		// Get the language ID.
		const langId = this._getLangId();

		// Clear Python-specific state.
		const cleanPython = () => {
			this._pythonEnvSetupType = undefined;
			this._pythonEnvProviderId = undefined;
			this._installIpykernel = undefined;
			this._minimumPythonVersion = undefined;
			this._condaPythonVersion = undefined;
			this._condaPythonVersionInfo = undefined;
			this._isCondaInstalled = undefined;
			this._uvPythonVersion = undefined;
			this._uvPythonVersionInfo = undefined;
			this._isUvInstalled = undefined;
			this._createPyprojectToml = undefined;
		};

		// Clear R-specific state.
		const cleanR = () => {
			this._useRenv = undefined;
			this._minimumRVersion = undefined;
		};

		// Clean up the state based on the language ID.
		if (!langId) {
			cleanPython();
			cleanR();
		} else if (langId === LanguageIds.Python) {
			cleanR();
			this._useRenv = undefined;
			const existingEnv = this._pythonEnvSetupType === EnvironmentSetupType.ExistingEnvironment;
			if (existingEnv) {
				this._pythonEnvProviderId = undefined;
			}
			if (this._usesCondaEnv() || this._usesUvEnv()) {
				this._selectedRuntime = undefined;
			} else {
				this._condaPythonVersion = undefined;
				this._uvPythonVersion = undefined;
			}
		} else if (langId === LanguageIds.R) {
			cleanPython();
		} else {
			// If the language ID is unrecognized, log the error.
			this._services.logService.error(`[New Folder Flow] Unrecognized language ID: ${langId}`);
		}
	}

	//#endregion Private Methods
}
