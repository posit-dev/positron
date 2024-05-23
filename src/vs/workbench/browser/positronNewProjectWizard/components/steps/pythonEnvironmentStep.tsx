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
import { EnvironmentSetupType, PythonEnvironmentProvider } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { InterpreterEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/interpreterEntry';
import { DropdownEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/dropdownEntry';
import { WizardFormattedText, WizardFormattedTextType } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardFormattedText';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { DropDownListBox } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { interpretersToDropdownItems } from 'vs/workbench/browser/positronNewProjectWizard/utilities/interpreterDropDownUtils';

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
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context]);

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

	// Handler for when the interpreter is selected.
	const onInterpreterSelected = async (identifier: string) => {
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
				disable: !selectedInterpreter
			}}
		>
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
					feedback={
						envProviders.length > 0 ? (
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
											envProviders
										)
									)}
								</code>
							</WizardFormattedText>
						) : (
							<WizardFormattedText
								type={WizardFormattedTextType.Warning}
							>
								{(() =>
									localize(
										'pythonEnvironmentSubStep.feedback.noEnvProviders',
										"No environment providers found. Please use an existing Python installation."
									))()}
							</WizardFormattedText>
						)
					}
				>
					{envProviders.length > 0 ? (
						<DropDownListBox
							keybindingService={keybindingService}
							layoutService={layoutService}
							title={(() =>
								localize(
									'pythonEnvironmentSubStep.dropDown.title',
									"Select an environment type"
								))()}
							entries={envProviderInfoToDropDownItems(
								envProviders
							)}
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
					) : null}
				</PositronWizardSubStep> : null
			}
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
				feedback={
					envSetupType === EnvironmentSetupType.ExistingEnvironment &&
						selectedInterpreter &&
						willInstallIpykernel ? (
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
					) : envSetupType === EnvironmentSetupType.NewEnvironment &&
						envProviders.length === 0 ? (
						<WizardFormattedText
							type={WizardFormattedTextType.Warning}
						>
							{(() =>
								localize(
									'pythonInterpreterSubStep.feedback.noInterpretersAvailable',
									"No interpreters available since no environment providers were found."
								))()}
						</WizardFormattedText>
					) : undefined
				}
			>
				{envSetupType === EnvironmentSetupType.ExistingEnvironment || envProviders.length > 0 ? (
					<DropDownListBox
						keybindingService={keybindingService}
						layoutService={layoutService}
						disabled={!interpreters}
						title={(() =>
							!interpreters
								? localize(
									'pythonInterpreterSubStep.dropDown.title.loading',
									"Loading interpreters..."
								)
								: localize(
									'pythonInterpreterSubStep.dropDown.title',
									"Select a Python interpreter"
								))()}
						// TODO: if the runtime startup phase is complete, but there are no suitable
						// interpreters, show a message that no suitable interpreters were found and the
						// user should install an interpreter with minimum version
						entries={
							interpreters
								? interpretersToDropdownItems(
									interpreters,
									preferredInterpreter?.runtimeId,
									// TODO: remove this temporary flag once we are retrieving the
									// list of interpreters from the conda service
									envSetupType ===
									EnvironmentSetupType.NewEnvironment &&
									envProviderNameForId(
										envProviderId,
										envProviders
									) === PythonEnvironmentProvider.Conda
								)
								: []
						}
						selectedIdentifier={selectedInterpreter?.runtimeId}
						createItem={(item) => (
							<InterpreterEntry
								interpreterInfo={item.options.value}
							/>
						)}
						onSelectionChanged={(item) =>
							onInterpreterSelected(item.options.identifier)
						}
					/>
				) : null}
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
