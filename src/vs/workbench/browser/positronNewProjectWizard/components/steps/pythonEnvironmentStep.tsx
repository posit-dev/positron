/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { useNewProjectWizardContext } from '../../newProjectWizardContext.js';
import { NewProjectWizardStepProps } from '../../interfaces/newProjectWizardStepProps.js';
import { localize } from '../../../../../nls.js';
import { envProviderInfoToDropDownItems, envProviderNameForId, locationForNewEnv } from '../../utilities/pythonEnvironmentStepUtils.js';
import { PositronWizardStep } from '../wizardStep.js';
import { PositronWizardSubStep } from '../wizardSubStep.js';
import { RadioButtonItem } from '../../../positronComponents/positronModalDialog/components/radioButton.js';
import { RadioGroup } from '../../../positronComponents/positronModalDialog/components/radioGroup.js';
import { EnvironmentSetupType } from '../../interfaces/newProjectWizardEnums.js';
import { InterpreterEntry } from './interpreterEntry.js';
import { DropdownEntry } from './dropdownEntry.js';
import { WizardFormattedText, WizardFormattedTextType } from '../wizardFormattedText.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { DropDownListBox } from '../../../positronComponents/dropDownListBox/dropDownListBox.js';
import { interpretersToDropdownItems } from '../../utilities/interpreterDropDownUtils.js';
import { condaInterpretersToDropdownItems } from '../../utilities/condaUtils.js';
import { PathDisplay } from '../pathDisplay.js';

// NOTE: If you are making changes to this file, the equivalent R component may benefit from similar
// changes. See src/vs/workbench/browser/positronNewProjectWizard/components/steps/rConfigurationStep.tsx

/**
 * The PythonEnvironmentStep component is specific to Python projects in the new project wizard.
 * @param props The NewProjectWizardStepProps
 * @returns The rendered component
 */
export const PythonEnvironmentStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	// State.
	const context = useNewProjectWizardContext();
	const {
		keybindingService,
		layoutService,
		logService,
		languageRuntimeService,
	} = context.services;

	// Hooks.
	const [envSetupType, setEnvSetupType] = useState(context.pythonEnvSetupType);
	const [envProviders, setEnvProviders] = useState(context.pythonEnvProviders);
	const [envProviderId, setEnvProviderId] = useState(context.pythonEnvProvider);
	const [interpreters, setInterpreters] = useState(context.interpreters);
	const [selectedInterpreter, setSelectedInterpreter] = useState(context.selectedRuntime);
	const [preferredInterpreter, setPreferredInterpreter] = useState(context.preferredInterpreter);
	const [willInstallIpykernel, setWillInstallIpykernel] = useState(context.installIpykernel ?? false);
	const [minimumPythonVersion, setMinimumPythonVersion] = useState(context.minimumPythonVersion);
	const [condaPythonVersionInfo, setCondaPythonVersionInfo] = useState(context.condaPythonVersionInfo);
	const [selectedCondaPythonVersion, setSelectedCondaPythonVersion] = useState(context.condaPythonVersion);
	const [isCondaInstalled, setIsCondaInstalled] = useState(context.isCondaInstalled);

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onUpdateInterpreterState event handler and update the component state.
		disposableStore.add(context.onUpdateInterpreterState(() => {
			setEnvSetupType(context.pythonEnvSetupType);
			setEnvProviders(context.pythonEnvProviders);
			setEnvProviderId(context.pythonEnvProvider);
			setInterpreters(context.interpreters);
			setSelectedInterpreter(context.selectedRuntime);
			setPreferredInterpreter(context.preferredInterpreter);
			setWillInstallIpykernel(context.installIpykernel ?? false);
			setMinimumPythonVersion(context.minimumPythonVersion);
			setCondaPythonVersionInfo(context.condaPythonVersionInfo);
			setSelectedCondaPythonVersion(context.condaPythonVersion);
			setIsCondaInstalled(context.isCondaInstalled);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context]);

	// Utility functions.
	// At least one interpreter is available.
	const interpretersAvailable = () => {
		if (context.usesCondaEnv) {
			return !!isCondaInstalled &&
				!!condaPythonVersionInfo &&
				!!condaPythonVersionInfo.versions.length;
		}
		return !!interpreters && !!interpreters.length;
	};
	// If any of the values are undefined, the interpreters are still loading.
	const interpretersLoading = () => {
		if (context.usesCondaEnv) {
			return isCondaInstalled === undefined || condaPythonVersionInfo === undefined;
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
				"Create a new Python environment (Recommended)"
			)
		}),
		new RadioButtonItem({
			identifier: EnvironmentSetupType.ExistingEnvironment,
			title: localize(
				'pythonEnvironmentStep.existingEnvironment.radioLabel',
				"Use an existing Python installation"
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
	};

	// Construct the feedback message for the environment provider step.
	const envProviderStepFeedback = () => {
		if (!envProvidersLoading()) {
			if (envProvidersAvailable() && envProviderId) {
				// If there's at least one environment provider and a provider is selected, show the
				// environment path preview
				return (
					<WizardFormattedText
						type={WizardFormattedTextType.Info}
					>
						{(() =>
							localize(
								'pythonEnvironmentSubStep.feedback',
								"The environment will be created at: "
							))()}
						<PathDisplay
							maxLength={65}
							pathComponents={
								locationForNewEnv(
									context.parentFolder.path,
									context.projectName,
									envProviderNameForId(envProviderId, envProviders!)
								)
							}
							pathService={context.services.pathService}
						/>

					</WizardFormattedText>
				);
			}

			if (!envProvidersAvailable()) {
				// If there are no environment providers, show a warning message
				return (
					<WizardFormattedText
						type={WizardFormattedTextType.Warning}
					>
						{(() =>
							localize(
								'pythonEnvironmentSubStep.feedback.noEnvProviders',
								"No environment providers found. Please use an existing Python installation."
							))()}
					</WizardFormattedText>
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

		// Update the selected interpreter.
		const selectedRuntime = languageRuntimeService.getRegisteredRuntime(identifier);
		if (!selectedRuntime) {
			// This shouldn't happen, since the DropDownListBox should only allow selection of registered
			// runtimes
			logService.error(`No Python runtime found for identifier: ${identifier}`);
			return;
		}
		context.selectedRuntime = selectedRuntime;
	};

	// Construct the feedback message for the interpreter step.
	const interpreterStepFeedback = () => {
		if (!interpretersLoading() && !interpretersAvailable()) {
			// For new environments, if no environment providers were found, show a message to notify
			// the user that interpreters can't be shown since no environment providers were found.
			if (envSetupType === EnvironmentSetupType.NewEnvironment) {
				return (
					<WizardFormattedText
						type={WizardFormattedTextType.Warning}
					>
						{(() =>
							localize(
								'pythonInterpreterSubStep.feedback.noInterpretersAvailable',
								"No interpreters available since no environment providers were found."
							))()}
					</WizardFormattedText>
				);
			}

			if (context.usesCondaEnv) {
				return (
					<WizardFormattedText
						type={WizardFormattedTextType.Warning}
					>
						{(() =>
							localize(
								'pythonInterpreterSubStep.feedback.condaNotInstalled',
								"Conda is not installed. Please install Conda to create a Conda environment."
							))()}
					</WizardFormattedText>
				);
			}

			// If the interpreters list is empty, show a message that no interpreters were found.
			return (
				<WizardFormattedText
					type={WizardFormattedTextType.Warning}
				>
					{(() =>
						localize(
							'pythonInterpreterSubStep.feedback.noSuitableInterpreters',
							"No suitable interpreters found. Please install a Python interpreter with version {0} or later.",
							minimumPythonVersion
						))()}
				</WizardFormattedText>
			);
		}

		// If ipykernel will be installed, show a message to notify the user.
		if (willInstallIpykernel) {
			return (
				<WizardFormattedText type={WizardFormattedTextType.Info}>
					<code>ipykernel</code>
					{(() =>
						localize(
							'pythonInterpreterSubStep.feedback',
							" will be installed for Python language support."
						))()}
				</WizardFormattedText>
			);
		}

		// If none of the above conditions are met, no feedback is shown.
		return undefined;
	};

	// Construct the interpreter dropdown title.
	const interpreterDropdownTitle = () => {
		// If interpreters is undefined, show a loading message.
		if (interpretersLoading()) {
			return localize(
				'pythonInterpreterSubStep.dropDown.title.loading',
				"Loading interpreters..."
			);
		}

		// If interpreters is empty, show a message that no interpreters were found.
		if (!interpretersAvailable()) {
			return localize(
				'pythonInterpreterSubStep.dropDown.title.noInterpreters',
				"No interpreters found."
			);
		}

		// Otherwise, show the default title.
		return localize(
			'pythonInterpreterSubStep.dropDown.title',
			"Select a Python interpreter"
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

		return selectedInterpreter?.runtimeId;
	};

	// Whether the create button should be disabled.
	const disableCreateButton = () => {
		if (context.usesCondaEnv) {
			return !selectedCondaPythonVersion;
		}
		return !selectedInterpreter;
	};

	// Render.
	return (
		<PositronWizardStep
			backButtonConfig={{ onClick: props.back }}
			cancelButtonConfig={{ onClick: props.cancel }}
			okButtonConfig={{
				onClick: props.accept,
				title: (() => localize(
					'positronNewProjectWizard.createButtonTitle',
					"Create"
				))(),
				disable: disableCreateButton()
			}}
			title={(() => localize(
				'pythonEnvironmentStep.title',
				"Set up Python environment"
			))()}
		>
			{/* New or existing Python environment selection */}
			<PositronWizardSubStep
				title={(() => localize(
					'pythonEnvironmentSubStep.howToSetUpEnv',
					"How would you like to set up your Python project environment?"
				))()}
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
			</PositronWizardSubStep>
			{/* If New Environment, show dropdown for Python environment providers */}
			{envSetupType === EnvironmentSetupType.NewEnvironment ?
				<PositronWizardSubStep
					description={
						<WizardFormattedText type={WizardFormattedTextType.Info}>
							{(() => localize(
								'pythonEnvironmentSubStep.description',
								"Select an environment type for your project."
							))()}
						</WizardFormattedText>
					}
					feedback={envProviderStepFeedback()}
					title={(() => localize(
						'pythonEnvironmentSubStep.label',
						"Python Environment"
					))()}
				>
					<DropDownListBox
						createItem={(item) => (
							<DropdownEntry
								subtitle={item.options.value.description}
								title={item.options.value.name}
							/>
						)}
						disabled={!envProvidersAvailable()}
						entries={envProviderDropdownEntries()}
						keybindingService={keybindingService}
						layoutService={layoutService}
						selectedIdentifier={envProviderId}
						title={envProviderDropdownTitle()}
						onSelectionChanged={(item) =>
							onEnvProviderSelected(item.options.identifier)
						}
					/>
				</PositronWizardSubStep> : null
			}
			{/* Show the Python interpreter dropdown */}
			<PositronWizardSubStep
				description={(() =>
					localize(
						'pythonInterpreterSubStep.description',
						"Select a Python installation for your project."
					))()}
				feedback={interpreterStepFeedback()}
				title={(() =>
					localize(
						'pythonInterpreterSubStep.title',
						"Python Interpreter"
					))()}
			>
				<DropDownListBox
					createItem={(item) => (
						<InterpreterEntry
							interpreterInfo={item.options.value}
						/>
					)}
					disabled={!interpretersAvailable()}
					entries={interpreterDropdownEntries()}
					keybindingService={keybindingService}
					layoutService={layoutService}
					selectedIdentifier={selectedInterpreterId()}
					title={interpreterDropdownTitle()}
					onSelectionChanged={(item) =>
						onInterpreterSelected(item.options.identifier)
					}
				/>
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
