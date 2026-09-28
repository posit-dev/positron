/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './pythonEnvironmentStep.css';

// React.
import { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { useNewFolderFlowContext } from '../../newFolderFlowContext.js';
import { NewFolderFlowStepProps } from '../../interfaces/newFolderFlowStepProps.js';
import { localize } from '../../../../../nls.js';
import { envProviderInfoToDropDownItems, envProviderNameForId, getDefaultEnvName, locationForNewEnv } from '../../utilities/pythonEnvironmentStepUtils.js';
import { PositronFlowStep } from '../flowStep.js';
import { PositronFlowSubStep } from '../flowSubStep.js';
import { RadioButtonItem } from '../../../positronComponents/positronModalDialog/components/radioButton.js';
import { RadioGroup } from '../../../positronComponents/positronModalDialog/components/radioGroup.js';
import { LabeledTextInput } from '../../../positronComponents/positronModalDialog/components/labeledTextInput.js';
import { EnvironmentSetupType } from '../../interfaces/newFolderFlowEnums.js';
import { InterpreterEntry } from './interpreterEntry.js';
import { DropdownEntry } from './dropdownEntry.js';
import { FlowFormattedText, FlowFormattedTextType } from '../flowFormattedText.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { DropDownListBox } from '../../../positronComponents/dropDownListBox/dropDownListBox.js';
import { interpretersToDropdownItems } from '../../utilities/interpreterDropDownUtils.js';
import { condaInterpretersToDropdownItems } from '../../utilities/condaUtils.js';
import { uvInterpretersToDropdownItems } from '../../utilities/uvUtils.js';
import { PathDisplay } from '../pathDisplay.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

// NOTE: If you are making changes to this file, the equivalent R component may benefit from similar
// changes. See src/vs/workbench/browser/positronNewFolderFlow/components/steps/rConfigurationStep.tsx

/**
 * The PythonEnvironmentStep component is specific to Python projects in the New Folder Flow.
 * @param props The NewFolderFlowStepProps
 * @returns The rendered component
 */
export const PythonEnvironmentStep = (props: PropsWithChildren<NewFolderFlowStepProps>) => {
	// State.
	const services = usePositronReactServicesContext();
	const context = useNewFolderFlowContext();

	// Hooks.
	const [envSetupType, setEnvSetupType] = useState(context.pythonEnvSetupType);
	const [envProviders, setEnvProviders] = useState(context.pythonEnvProviders);
	const [envProviderId, setEnvProviderId] = useState(context.pythonEnvProvider);
	const [envName, setEnvName] = useState(context.pythonEnvName);
	const [interpreters, setInterpreters] = useState(context.interpreters);
	const [selectedInterpreter, setSelectedInterpreter] = useState(context.selectedRuntime);
	const [preferredInterpreter, setPreferredInterpreter] = useState(context.preferredInterpreter);
	const [willInstallIpykernel, setWillInstallIpykernel] = useState(context.installIpykernel ?? false);
	const [minimumPythonVersion, setMinimumPythonVersion] = useState(context.minimumPythonVersion);
	const [condaPythonVersionInfo, setCondaPythonVersionInfo] = useState(context.condaPythonVersionInfo);
	const [selectedCondaPythonVersion, setSelectedCondaPythonVersion] = useState(context.condaPythonVersion);
	const [isCondaInstalled, setIsCondaInstalled] = useState(context.isCondaInstalled);
	const [uvPythonVersionInfo, setUvPythonVersionInfo] = useState(context.uvPythonVersionInfo);
	const [selectedUvPythonVersion, setSelectedUvPythonVersion] = useState(context.uvPythonVersion);
	const [isUvInstalled, setIsUvInstalled] = useState(context.isUvInstalled);
	const [uvInstallPending, setUvInstallPending] = useState(false);
	const [uvInstallError, setUvInstallError] = useState<string | undefined>(undefined);

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onUpdateInterpreterState event handler and update the component state.
		disposableStore.add(context.onUpdateInterpreterState(() => {
			setEnvSetupType(context.pythonEnvSetupType);
			setEnvProviders(context.pythonEnvProviders);
			setEnvProviderId(context.pythonEnvProvider);
			setEnvName(context.pythonEnvName);
			setInterpreters(context.interpreters);
			setSelectedInterpreter(context.selectedRuntime);
			setPreferredInterpreter(context.preferredInterpreter);
			setWillInstallIpykernel(context.installIpykernel ?? false);
			setMinimumPythonVersion(context.minimumPythonVersion);
			setCondaPythonVersionInfo(context.condaPythonVersionInfo);
			setSelectedCondaPythonVersion(context.condaPythonVersion);
			setIsCondaInstalled(context.isCondaInstalled);
			setUvPythonVersionInfo(context.uvPythonVersionInfo);
			setSelectedUvPythonVersion(context.uvPythonVersion);
			setIsUvInstalled(context.isUvInstalled);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context]);

	// Set the default environment name when the provider changes.
	useEffect(() => {
		if (envSetupType === EnvironmentSetupType.NewEnvironment && envProviders && envProviderId) {
			const providerName = envProviderNameForId(envProviderId, envProviders);
			const defaultName = getDefaultEnvName(providerName);
			// Only set if no name has been set yet (undefined or null, not empty string)
			if (envName === undefined || envName === null) {
				setEnvName(defaultName);
				context.pythonEnvName = defaultName;
			}
		}
		// Note: envName is intentionally NOT in the dependency array to avoid resetting
		// when user clears the input
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [envSetupType, envProviderId, envProviders, context]);

	// Clear the install error when the provider or setup type changes. The error describes an
	// attempt made for the provider selected at the time, so on any other selection it reports a
	// failure that did not happen there.
	useEffect(() => {
		setUvInstallError(undefined);
	}, [envProviderId, envSetupType]);

	// Utility functions.
	// At least one interpreter is available.
	const interpretersAvailable = () => {
		if (context.usesCondaEnv) {
			return !!isCondaInstalled &&
				!!condaPythonVersionInfo &&
				!!condaPythonVersionInfo.versions.length;
		}
		if (context.usesUvEnv) {
			return !!isUvInstalled &&
				!!uvPythonVersionInfo &&
				!!uvPythonVersionInfo.versions.length;
		}
		return !!interpreters && !!interpreters.length;
	};
	// If any of the values are undefined, the interpreters are still loading.
	const interpretersLoading = () => {
		if (context.usesCondaEnv) {
			return isCondaInstalled === undefined || condaPythonVersionInfo === undefined;
		}
		if (context.usesUvEnv) {
			return isUvInstalled === undefined || uvPythonVersionInfo === undefined;
		}
		return interpreters === undefined;
	};
	const envProvidersAvailable = () => Boolean(envProviders && envProviders.length);
	const envProvidersLoading = () => !envProviders;

	// Radio buttons for selecting the environment setup type.
	const envSetupRadioButtons: RadioButtonItem[] = [
		new RadioButtonItem({
			identifier: EnvironmentSetupType.NewEnvironment,
			title: localize(
				'pythonEnvironmentStep.newEnvironment.radioLabel',
				"Create a new virtual environment (Recommended)"
			)
		}),
		new RadioButtonItem({
			identifier: EnvironmentSetupType.ExistingEnvironment,
			title: localize(
				'pythonEnvironmentStep.existingEnvironment.radioLabel',
				"Use an existing environment"
			)
		})
	];

	// Handler for when the environment setup type is selected.
	const onEnvSetupTypeSelected = (identifier: string) => {
		const setupType = identifier as EnvironmentSetupType;
		context.pythonEnvSetupType = setupType;
		setEnvSetupType(setupType);
	};

	// Handler for when the environment provider is selected.
	const onEnvProviderSelected = (identifier: string) => {
		context.pythonEnvProvider = identifier;
		setEnvProviderId(identifier);
		// Reset the environment name to the default for the new provider.
		const providerName = envProviderNameForId(identifier, envProviders!);
		const defaultName = getDefaultEnvName(providerName);
		setEnvName(defaultName);
		context.pythonEnvName = defaultName;
	};

	// Handler for when the environment name is changed.
	const onEnvNameChanged = (value: string) => {
		setEnvName(value);
		context.pythonEnvName = value;
	};

	// Construct the feedback message for the environment provider step.
	const envProviderStepFeedback = () => {
		if (!envProvidersLoading()) {
			if (envProvidersAvailable() && envProviderId) {
				// If there's at least one environment provider and a provider is selected, show the
				// environment path preview
				return (
					<FlowFormattedText
						type={FlowFormattedTextType.Info}
					>
						{/* One span, so the path wraps with the sentence instead of beside it. */}
						<span>
							{localize(
								'pythonEnvironmentSubStep.feedback',
								"The environment will be created at "
							)}
							<PathDisplay
								maxLength={65}
								pathComponents={
									locationForNewEnv(
										context.parentFolder.path,
										context.folderName,
										envProviderNameForId(envProviderId, envProviders!),
										envName
									)
								}
								pathService={context.services.pathService}
							/>
						</span>
					</FlowFormattedText>
				);
			}

			if (!envProvidersAvailable()) {
				// If there are no environment providers, show a warning message
				return (
					<FlowFormattedText
						type={FlowFormattedTextType.Warning}
					>
						{localize(
							'pythonEnvironmentSubStep.feedback.noEnvProviders',
							"No environment providers found. Please use an existing Python installation."
						)}
					</FlowFormattedText>
				);
			}
		}

		// If none of the above conditions are met, no feedback is shown.
		return undefined;
	};

	// Construct the environment provider dropdown title.
	const envProviderDropdownTitle = () => {
		// If interpreters is undefined, show a loading message.
		if (envProvidersLoading()) {
			return localize(
				'pythonEnvironmentSubStep.dropDown.title.loading',
				"Loading environment providers..."
			);
		}

		// If interpreters is empty, show a message that no interpreters were found.
		if (!envProvidersAvailable()) {
			return localize(
				'pythonEnvironmentSubStep.dropDown.title.noProviders',
				"No environment providers found."
			);
		}

		// Otherwise, show the default title.
		return localize(
			'pythonEnvironmentSubStep.dropDown.title',
			"Select an environment type"
		);
	};

	// Construct the environment provider dropdown entries
	const envProviderDropdownEntries = () => {
		if (!envProvidersAvailable()) {
			return [];
		}
		return envProviderInfoToDropDownItems(envProviders!);
	};

	// Handler for when the interpreter is selected.
	const onInterpreterSelected = async (identifier: string) => {
		if (context.usesCondaEnv) {
			// If the environment is for Conda, the selected interpreter is the Python version.
			context.condaPythonVersion = identifier;
			return;
		}
		if (context.usesUvEnv) {
			// If the environment is for uv, the selected interpreter is the Python version.
			context.uvPythonVersion = identifier;
			return;
		}

		// Update the selected interpreter.
		const selectedRuntime = services.languageRuntimeService.getRegisteredRuntime(identifier);
		if (!selectedRuntime) {
			// This shouldn't happen, since the DropDownListBox should only allow selection of registered
			// runtimes
			services.logService.error(`No Python runtime found for identifier: ${identifier}`);
			return;
		}
		context.selectedRuntime = selectedRuntime;
	};

	// Handler for the Install uv button. On success, the flow state refreshes the uv Python
	// versions and fires onUpdateInterpreterState, which repopulates the version dropdown.
	const onInstallUv = async () => {
		setUvInstallPending(true);
		setUvInstallError(undefined);
		try {
			const result = await context.installUv();
			if (!result.ok) {
				// A declined install has no error message; leave the step as it was.
				setUvInstallError(result.error);
			}
		} finally {
			setUvInstallPending(false);
		}
	};

	// The "not installed" notice for the selected environment provider, shown under the provider
	// dropdown: a missing tool is a fact about the provider just picked, not about the version list.
	// uv can install itself, so it carries an action; conda has no equivalent command to offer.
	const providerInstallWarning = () => {
		if (context.usesUvEnv && isUvInstalled === false) {
			return (
				<FlowFormattedText
					type={FlowFormattedTextType.Warning}
				>
					<span>
						{uvInstallError ?? localize(
							'pythonEnvironmentSubStep.feedback.uvNotInstalled',
							"uv is not installed"
						)}
					</span>
					<span aria-hidden='true' className='install-uv-separator'>&middot;</span>
					{/* Inert while the request is out, but still labelled "Install uv": the request */}
					{/* starts by asking the user to confirm, and nothing installs until they do. */}
					<Button
						ariaDisabled={uvInstallPending}
						className='install-uv-button'
						onPressed={onInstallUv}
					>
						{localize(
							'pythonEnvironmentSubStep.feedback.installUv',
							"Install uv"
						)}
					</Button>
				</FlowFormattedText>
			);
		}

		if (context.usesCondaEnv && isCondaInstalled === false) {
			return (
				<FlowFormattedText
					type={FlowFormattedTextType.Warning}
				>
					{localize(
						'pythonEnvironmentSubStep.feedback.condaNotInstalled',
						"Conda is not installed"
					)}
				</FlowFormattedText>
			);
		}

		return undefined;
	};

	// Construct the feedback message for the interpreter step.
	const interpreterStepFeedback = () => {
		if (!interpretersLoading() && !interpretersAvailable()) {
			// Exactly what providerInstallWarning() already reports above. Checked before the
			// new-environment branch, which returns unconditionally and would otherwise blame a
			// missing provider instead.
			if ((context.usesUvEnv && isUvInstalled === false) ||
				(context.usesCondaEnv && isCondaInstalled === false)) {
				return undefined;
			}

			// For new environments, if no environment providers were found, show a message to notify
			// the user that interpreters can't be shown since no environment providers were found.
			if (envSetupType === EnvironmentSetupType.NewEnvironment) {
				return (
					<FlowFormattedText
						type={FlowFormattedTextType.Warning}
					>
						{localize(
							'pythonInterpreterSubStep.feedback.noInterpretersAvailable',
							"No interpreters available since no environment providers were found."
						)}
					</FlowFormattedText>
				);
			}

			// If the interpreters list is empty, show a message that no interpreters were found.
			return (
				<FlowFormattedText
					type={FlowFormattedTextType.Warning}
				>
					{localize(
						'pythonInterpreterSubStep.feedback.noSuitableInterpreters',
						"No suitable interpreters found. Please install a Python interpreter with version {0} or later.",
						minimumPythonVersion
					)}
				</FlowFormattedText>
			);
		}

		// If ipykernel will be installed, show a message to notify the user.
		if (willInstallIpykernel) {
			return (
				<FlowFormattedText type={FlowFormattedTextType.Info}>
					<code>ipykernel</code>
					{localize(
						'pythonInterpreterSubStep.feedback',
						" will be installed for Python language support."
					)}
				</FlowFormattedText>
			);
		}

		// If none of the above conditions are met, no feedback is shown.
		return undefined;
	};

	// Construct the interpreter dropdown title.
	const interpreterDropdownTitle = () => {
		const interpreterOrVersion = (context.usesCondaEnv || context.usesUvEnv) ? 'version' : 'interpreter';

		// If interpreters is undefined, show a loading message.
		if (interpretersLoading()) {
			return localize(
				'pythonInterpreterSubStep.dropDown.title.loading',
				"Loading {0}s...",
				interpreterOrVersion
			);
		}

		// If interpreters is empty, show a message that no interpreters were found. When uv is
		// missing, nothing was ever looked up, so name the blocker instead of reporting an
		// empty search.
		if (!interpretersAvailable()) {
			if (context.usesUvEnv && isUvInstalled === false) {
				return localize(
					'pythonInterpreterSubStep.dropDown.title.uvNotInstalled',
					"Install uv to select a Python version"
				);
			}

			if (context.usesCondaEnv && isCondaInstalled === false) {
				return localize(
					'pythonInterpreterSubStep.dropDown.title.condaNotInstalled',
					"Install Conda to select a Python version"
				);
			}

			return localize(
				'pythonInterpreterSubStep.dropDown.title.noInterpreters',
				"No {0}s found.",
				interpreterOrVersion
			);
		}

		// Otherwise, show the default title.
		return localize(
			'pythonInterpreterSubStep.dropDown.title',
			"Select a Python {0}",
			interpreterOrVersion
		);
	};

	// Construct the interpreter dropdown entries
	const interpreterDropdownEntries = () => {
		if (!interpretersAvailable()) {
			return [];
		}

		// Conda-specific handling.
		if (context.usesCondaEnv) {
			return condaInterpretersToDropdownItems(condaPythonVersionInfo);
		}

		// uv-specific handling.
		if (context.usesUvEnv) {
			return uvInterpretersToDropdownItems(uvPythonVersionInfo);
		}

		// Otherwise, show the regular interpreters.
		return interpretersToDropdownItems(
			interpreters!,
			preferredInterpreter?.runtimeId
		);
	};

	// Get the selected interpreter ID.
	const selectedInterpreterId = () => {
		if (context.usesCondaEnv) {
			return selectedCondaPythonVersion;
		}
		if (context.usesUvEnv) {
			return selectedUvPythonVersion;
		}

		return selectedInterpreter?.runtimeId;
	};

	// Whether the create button should be disabled.
	const disableCreateButton = () => {
		if (context.usesCondaEnv) {
			return !selectedCondaPythonVersion;
		}
		if (context.usesUvEnv) {
			return !selectedUvPythonVersion;
		}
		return !selectedInterpreter;
	};

	// Render.
	return (
		<PositronFlowStep
			backButtonConfig={{ onClick: props.back }}
			cancelButtonConfig={{ onClick: props.cancel }}
			okButtonConfig={{
				onClick: props.accept,
				title: localize(
					'positronNewFolderFlow.createButtonTitle',
					"Create"
				),
				disable: disableCreateButton()
			}}
			title={localize(
				'pythonEnvironmentStep.title',
				"Python Environment"
			)}
		>
			{/* New or existing Python environment selection */}
			<PositronFlowSubStep
				title={localize(
					'pythonEnvironmentSubStep.howToSetUpEnv',
					"How would you like to set up your Python environment?"
				)}
				titleId='pythonEnvironment-howToSetUpEnv'
			>
				<RadioGroup
					entries={envSetupRadioButtons}
					initialSelectionId={envSetupType}
					labelledBy='pythonEnvironment-howToSetUpEnv'
					name='envSetup'
					onSelectionChanged={
						identifier => onEnvSetupTypeSelected(identifier)
					}
				/>
			</PositronFlowSubStep>
			{/* If New Environment, show dropdown for Python environment providers */}
			{envSetupType === EnvironmentSetupType.NewEnvironment ?
				<PositronFlowSubStep
					description={
						<FlowFormattedText type={FlowFormattedTextType.Info}>
							{localize(
								'pythonEnvironmentSubStep.description',
								"Select a way to create a new virtual environment"
							)}
						</FlowFormattedText>
					}
					feedback={envProviderStepFeedback()}
					title={localize(
						'pythonEnvironmentSubStep.label',
						"Environment Creation"
					)}
				>
					<div className='env-provider-selection'>
						<DropDownListBox
							createItem={(item) => (
								<DropdownEntry
									subtitle={item.options.value.description}
									title={item.options.value.name}
								/>
							)}
							disabled={!envProvidersAvailable()}
							entries={envProviderDropdownEntries()}
							selectedIdentifier={envProviderId}
							title={envProviderDropdownTitle()}
							onSelectionChanged={(item) =>
								onEnvProviderSelected(item.options.identifier)
							}
						/>
						{providerInstallWarning()}
					</div>
					<LabeledTextInput
						label={localize(
							'pythonEnvironmentNameSubStep.label',
							"Environment name"
						)}
						value={envName ?? ''}
						onChange={(e) => onEnvNameChanged(e.target.value)}
					/>
				</PositronFlowSubStep> : null
			}
			{/* Show the Python interpreter dropdown */}
			<PositronFlowSubStep
				description={(() => {
					const whatToSelect = (context.usesCondaEnv || context.usesUvEnv) ? 'a Python version' : 'an existing interpreter';
					return localize(
						'pythonInterpreterSubStep.description',
						"Select {0}",
						whatToSelect
					);
				})()}
				feedback={interpreterStepFeedback()}
				title={(() => {
					const interpreterOrVersion = (context.usesCondaEnv || context.usesUvEnv) ? 'Version' : 'Interpreter';
					return localize(
						'pythonInterpreterSubStep.title',
						"Python {0}",
						interpreterOrVersion
					);
				})()}
				titleId='pythonEnvironment-interpreterOrVersion'
			>
				<DropDownListBox
					createItem={(item) => (
						<InterpreterEntry
							interpreterInfo={item.options.value}
						/>
					)}
					disabled={!interpretersAvailable()}
					entries={interpreterDropdownEntries()}
					selectedIdentifier={selectedInterpreterId()}
					title={interpreterDropdownTitle()}
					onSelectionChanged={(item) =>
						onInterpreterSelected(item.options.identifier)
					}
				/>
			</PositronFlowSubStep>
		</PositronFlowStep>
	);
};
