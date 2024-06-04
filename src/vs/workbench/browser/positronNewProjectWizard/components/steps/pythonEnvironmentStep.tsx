/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStepProps';
import { localize } from 'vs/nls';
import { envProviderInfoToDropDownItems, envProviderNameForId, locationForNewEnv } from 'vs/workbench/browser/positronNewProjectWizard/utilities/pythonEnvironmentStepUtils';
import { PositronWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardStep';
import { PositronWizardSubStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardSubStep';
import { RadioButtonItem } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioButton';
import { RadioGroup } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioGroup';
import { EnvironmentSetupType } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { InterpreterEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/interpreterEntry';
import { DropdownEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/dropdownEntry';
import { WizardFormattedText, WizardFormattedTextType } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardFormattedText';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { DropDownListBox } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { interpretersToDropdownItems } from 'vs/workbench/browser/positronNewProjectWizard/utilities/interpreterDropDownUtils';
import { condaInterpretersToDropdownItems } from 'vs/workbench/browser/positronNewProjectWizard/utilities/condaUtils';

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
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context]);

	// Utility functions.
	const interpretersAvailable = () =>
		Boolean(interpreters && interpreters.length) ||
		// Interpreters are always available for Conda because we display the supported versions
		// that an environment can be created with.
		Boolean(context.usesCondaEnv && condaPythonVersionInfo);
	const interpretersLoading = () => !interpreters && !condaPythonVersionInfo;
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
						<code>
							{locationForNewEnv(
								context.parentFolder,
								context.projectName,
								envProviderNameForId(
									envProviderId,
									envProviders!
								)
							)}
						</code>
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
		// For existing environments, if an interpreter is selected and ipykernel will be installed,
		// show a message to notify the user that ipykernel will be installed.
		if (envSetupType === EnvironmentSetupType.ExistingEnvironment &&
			selectedInterpreter &&
			willInstallIpykernel) {
			return (
				<WizardFormattedText
					type={WizardFormattedTextType.Info}
				>
					<code>ipykernel</code>
					{(() =>
						localize(
							'pythonInterpreterSubStep.feedback',
							" will be installed for Python language support."
						))()}
				</WizardFormattedText>
			);
		}

		// For new environments, if no environment providers were found, show a message to notify
		// the user that interpreters can't be shown since no environment providers were found.
		if (envSetupType === EnvironmentSetupType.NewEnvironment &&
			!envProvidersLoading() &&
			!envProvidersAvailable()
		) {
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

		// If the interpreters list is empty, show a message that no interpreters were found.
		if (!interpretersLoading() && !interpretersAvailable()) {
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
			title={(() => localize(
				'pythonEnvironmentStep.title',
				"Set up Python environment"
			))()}
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
					name='envSetup'
					labelledBy='pythonEnvironment-howToSetUpEnv'
					entries={envSetupRadioButtons}
					initialSelectionId={envSetupType}
					onSelectionChanged={
						identifier => onEnvSetupTypeSelected(identifier)
					}
				/>
			</PositronWizardSubStep>
			{/* If New Environment, show dropdown for Python environment providers */}
			{envSetupType === EnvironmentSetupType.NewEnvironment ?
				<PositronWizardSubStep
					title={(() => localize(
						'pythonEnvironmentSubStep.label',
						"Python Environment"
					))()}
					description={
						<WizardFormattedText type={WizardFormattedTextType.Info}>
							{(() => localize(
								'pythonEnvironmentSubStep.description',
								"Select an environment type for your project."
							))()}
							<code>ipykernel</code>
							{(() => localize(
								'pythonInterpreterSubStep.feedback',
								" will be installed for Python language support."
							))()}
						</WizardFormattedText>
					}
					feedback={envProviderStepFeedback()}
				>
					<DropDownListBox
						keybindingService={keybindingService}
						layoutService={layoutService}
						disabled={!envProvidersAvailable()}
						title={envProviderDropdownTitle()}
						entries={envProviderDropdownEntries()}
						selectedIdentifier={envProviderId}
						createItem={(item) => (
							<DropdownEntry
								title={item.options.value.name}
								subtitle={item.options.value.description}
							/>
						)}
						onSelectionChanged={(item) =>
							onEnvProviderSelected(item.options.identifier)
						}
					/>
				</PositronWizardSubStep> : null
			}
			{/* Show the Python interpreter dropdown */}
			<PositronWizardSubStep
				title={(() =>
					localize(
						'pythonInterpreterSubStep.title',
						"Python Interpreter"
					))()}
				description={(() =>
					localize(
						'pythonInterpreterSubStep.description',
						"Select a Python installation for your project. You can modify this later if you change your mind."
					))()}
				feedback={interpreterStepFeedback()}
			>
				<DropDownListBox
					keybindingService={keybindingService}
					layoutService={layoutService}
					disabled={!interpretersAvailable()}
					title={interpreterDropdownTitle()}
					entries={interpreterDropdownEntries()}
					selectedIdentifier={selectedInterpreterId()}
					createItem={(item) => (
						<InterpreterEntry
							interpreterInfo={item.options.value}
						/>
					)}
					onSelectionChanged={(item) =>
						onInterpreterSelected(item.options.identifier)
					}
				/>
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
