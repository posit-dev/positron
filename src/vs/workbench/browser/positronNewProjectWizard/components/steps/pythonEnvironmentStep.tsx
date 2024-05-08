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
import { RuntimeStartupPhase } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { envProviderInfoToDropDownItems, envProviderNameForId, getPythonInterpreterEntries, locationForNewEnv } from 'vs/workbench/browser/positronNewProjectWizard/utilities/pythonEnvironmentStepUtils';
import { PositronWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardStep';
import { PositronWizardSubStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardSubStep';
import { DropDownListBox, DropDownListBoxEntry } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { RadioButtonItem } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioButton';
import { RadioGroup } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioGroup';
import { EnvironmentSetupType, LanguageIds } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { InterpreterEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/pythonInterpreterEntry';
import { DropdownEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/dropdownEntry';
import { InterpreterInfo, getSelectedInterpreter } from 'vs/workbench/browser/positronNewProjectWizard/utilities/interpreterDropDownUtils';
import { WizardFormattedText, WizardFormattedTextType } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardFormattedText';
import { ILanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * The PythonEnvironmentStep component is specific to Python projects in the new project wizard.
 * @param props The NewProjectWizardStepProps
 * @returns The rendered component
 */
export const PythonEnvironmentStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	// Retrieve the wizard state and project configuration.
	const newProjectWizardState = useNewProjectWizardContext();
	const setProjectConfig = newProjectWizardState.setProjectConfig;
	const envProviders = newProjectWizardState.pythonEnvProviders;
	const projectConfig = newProjectWizardState.projectConfig;
	const keybindingService = newProjectWizardState.keybindingService;
	const layoutService = newProjectWizardState.layoutService;
	const logService = newProjectWizardState.logService;
	const runtimeStartupService = newProjectWizardState.runtimeStartupService;
	const languageRuntimeService = newProjectWizardState.languageRuntimeService;

	// Hooks to manage the startup phase and interpreter entries.
	const [startupPhase, setStartupPhase] = useState(
		runtimeStartupService.startupPhase
	);
	const runtimeStartupComplete = () =>
		startupPhase === RuntimeStartupPhase.Complete;
	const [envSetupType, setEnvSetupType] = useState(
		projectConfig.pythonEnvSetupType ?? EnvironmentSetupType.NewEnvironment
	);
	const [envProviderId, setEnvProviderId] = useState<string | undefined>(
		// Use the environment type already set in the project configuration; if not set, use the
		// first environment type in the provider list.
		// TODO: in the future, we may want to use the user's preferred environment type.
		projectConfig.pythonEnvProvider ?? envProviders[0]?.id
	);
	const [interpreterEntries, setInterpreterEntries] = useState(() =>
		// It's possible that the runtime discovery phase is not complete, so we need to check
		// for that before creating the interpreter entries.
		!runtimeStartupComplete()
			? []
			: getPythonInterpreterEntries(
				runtimeStartupService,
				languageRuntimeService,
				envSetupType,
				envProviderNameForId(envProviderId, envProviders)
			)
	);
	const [selectedInterpreter, setSelectedInterpreter] = useState(() =>
		getSelectedInterpreter(
			projectConfig.selectedRuntime,
			interpreterEntries,
			runtimeStartupService,
			LanguageIds.Python
		)
	);
	const [willInstallIpykernel, setWillInstallIpykernel] = useState(
		projectConfig.installIpykernel ?? false
	);

	const envSetupRadioButtons: RadioButtonItem[] = [
		new RadioButtonItem({
			identifier: EnvironmentSetupType.NewEnvironment,
			title: localize(
				'pythonEnvironmentStep.newEnvironment.radioLabel',
				'Create a new Python environment (Recommended)'
			)
		}),
		new RadioButtonItem({
			identifier: EnvironmentSetupType.ExistingEnvironment,
			title: localize(
				'pythonEnvironmentStep.existingEnvironment.radioLabel',
				'Use an existing Python installation'
			)
		})
	];

	// Utility function to get the interpreter based on the selected interpreter entries.
	const getInterpreter = (entries: DropDownListBoxEntry<string, InterpreterInfo>[]) => {
		return getSelectedInterpreter(
			selectedInterpreter,
			entries,
			runtimeStartupService,
			LanguageIds.Python
		);
	};

	// Utility function to check if ipykernel needs to be installed for the selected interpreter.
	const getInstallIpykernel = async (
		envSetupType: EnvironmentSetupType,
		pythonInterpreter: ILanguageRuntimeMetadata | undefined
	) => {
		let install = false;
		if (envSetupType === EnvironmentSetupType.NewEnvironment) {
			// ipykernel will always be installed for new environments.
			install = true;
		} else if (pythonInterpreter) {
			// When using an aliased runtimePath (starts with `~`) such as ~/myEnv/python instead of
			// a non-aliased path like /home/sharon/myEnv/python or /usr/bin/python, the ipykernel
			// version check errors, although the non-aliased pythonPath works fine.
			// In many cases, the pythonPath and runtimePath are the same. When they differ, it
			// seems that the pythonPath is the non-aliased runtimePath to the python interpreter.
			// From some brief debugging, it looks like many Conda, Pyenv and Venv environments have
			// aliased runtimePaths.
			const interpreterPath =
				pythonInterpreter.extraRuntimeData?.pythonPath ??
				pythonInterpreter.runtimePath;
			install = !(await newProjectWizardState.commandService.executeCommand(
				'python.isIpykernelInstalled',
				interpreterPath
			));
		}
		return install;
	};

	// Utility function to update the project configuration with the environment setup type,
	// environment type, selected interpreter, and ipykernel installation flag.
	const updateEnvConfig = async (
		envSetupType: EnvironmentSetupType,
		envProvider: string | undefined,
		interpreter: ILanguageRuntimeMetadata | undefined
	) => {
		// Update the project configuration with the new environment setup type.
		setEnvSetupType(envSetupType);

		// Update the project configuration with the new environment type.
		setEnvProviderId(envProvider);

		// Update the interpreter entries.
		const entries = getPythonInterpreterEntries(
			runtimeStartupService,
			languageRuntimeService,
			envSetupType,
			envProviderNameForId(envProviderId, envProviders)
		);
		setInterpreterEntries(entries);

		// Update the default selected interpreter based on the new entries.
		const selectedRuntime = interpreter ?? getInterpreter(entries);
		setSelectedInterpreter(selectedRuntime);

		// Update the installIpykernel flag for the selected interpreter.
		const installIpykernel = await getInstallIpykernel(envSetupType, selectedRuntime);
		setWillInstallIpykernel(installIpykernel);

		// Save the changes to the project configuration.
		setProjectConfig({
			...projectConfig,
			pythonEnvProvider: envProvider,
			pythonEnvSetupType: envSetupType,
			selectedRuntime,
			installIpykernel
		});
	};

	// Handler for when the environment setup type is selected. If the user selects the "existing
	// environment" setup, the env type dropdown will not show and the interpreter entries will be
	// updated to show all existing interpreters. The project configuration is updated as well.
	const onEnvSetupSelected = async (pythonEnvSetupType: EnvironmentSetupType) => {
		await updateEnvConfig(
			pythonEnvSetupType,
			envProviderId,
			selectedInterpreter
		);
	};

	// Handler for when the environment type is selected. The interpreter entries are updated based
	// on the selected environment type, and the project configuration is updated as well.
	const onEnvProviderSelected = async (providerId: string) => {
		await updateEnvConfig(envSetupType, providerId, selectedInterpreter);
	};

	// Handler for when the interpreter is selected. The project configuration is updated with the
	// selected interpreter and if ipykernel needs to be installed.
	const onInterpreterSelected = async (identifier: string) => {
		if (!runtimeStartupComplete()) {
			// This shouldn't happen, since the interpreter dropdown should be disabled until the
			// runtime discovery phase is complete.
			logService.error(
				'Cannot select Python interpreter until runtime discovery phase is complete.'
			);
		}

		// Update the selected interpreter.
		const selectedRuntime = languageRuntimeService.getRegisteredRuntime(identifier);
		if (!selectedRuntime) {
			// This shouldn't happen, since the DropDownListBox should only allow selection of registered
			// runtimes
			logService.error(`No Python runtime found for identifier: ${selectedInterpreter}`);
			return;
		}

		await updateEnvConfig(envSetupType, envProviderId, selectedRuntime);
	};

	// Update the project configuration with the initial selections. This is done once when the
	// component is mounted, assuming the runtime discovery phase is complete. If the runtime
	// discovery phase is not complete, the project configuration will be updated when the phase is
	// complete in the other useEffect hook below.
	useEffect(() => {
		if (runtimeStartupComplete()) {
			setProjectConfig({
				...projectConfig,
				pythonEnvSetupType: envSetupType,
				pythonEnvProvider: envProviderId,
				selectedRuntime: selectedInterpreter,
				installIpykernel: willInstallIpykernel
			});
		}
		// Pass an empty dependency array to run this effect only once when the component is mounted.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Hook to update the interpreter entries when the runtime discovery phase is complete. The
	// interpreter discovery phase may still be in progress when the component is mounted.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeRuntimeStartupPhase event handler; when the runtime discovery phase
		// is complete, update the interpreter entries.
		disposableStore.add(
			runtimeStartupService.onDidChangeRuntimeStartupPhase(
				async phase => {
					if (phase === RuntimeStartupPhase.Complete) {
						// Update the project configuration with the new environment setup type.
						setEnvSetupType(envSetupType);

						// Update the project configuration with the new environment type.
						setEnvProviderId(envProviderId);

						// Update the interpreter entries.
						const entries = getPythonInterpreterEntries(
							runtimeStartupService,
							languageRuntimeService,
							envSetupType,
							envProviderNameForId(envProviderId, envProviders)
						);
						setInterpreterEntries(entries);

						// Update the default selected interpreter based on the new entries.
						const selectedRuntime = getInterpreter(entries);
						setSelectedInterpreter(selectedRuntime);

						// Update the installIpykernel flag for the selected interpreter.
						const installIpykernel = await getInstallIpykernel(envSetupType, selectedRuntime);
						setWillInstallIpykernel(installIpykernel);

						// Save the changes to the project configuration.
						setProjectConfig({
							...projectConfig,
							pythonEnvSetupType: envSetupType,
							pythonEnvProvider: envProviderId,
							selectedRuntime,
							installIpykernel
						});
					}
					setStartupPhase(phase);
				}
			)
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
		// Pass an empty dependency array to run this effect only once when the component is mounted.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<PositronWizardStep
			title={(() => localize(
				'pythonEnvironmentStep.title',
				'Set up Python environment'
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
					'How would you like to set up your Python project environment?'
				))()}
				titleId='pythonEnvironment-howToSetUpEnv'
			>
				<RadioGroup
					name='envSetup'
					labelledBy='pythonEnvironment-howToSetUpEnv'
					entries={envSetupRadioButtons}
					initialSelectionId={envSetupType}
					onSelectionChanged={
						identifier => onEnvSetupSelected(identifier as EnvironmentSetupType)
					}
				/>
			</PositronWizardSubStep>
			{envSetupType === EnvironmentSetupType.NewEnvironment ?
				<PositronWizardSubStep
					title={(() => localize(
						'pythonEnvironmentSubStep.label',
						'Python Environment'
					))()}
					description={
						<WizardFormattedText type={WizardFormattedTextType.Info}>
							{(() => localize(
								'pythonEnvironmentSubStep.description',
								'Select an environment type for your project.'
							))()}
							<code>ipykernel</code>
							{(() => localize(
								'pythonInterpreterSubStep.feedback',
								' will be installed for Python language support.'
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
										'The environment will be created at: '
									))()}
								<code>
									{locationForNewEnv(
										projectConfig.parentFolder,
										projectConfig.projectName,
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
										'No environment providers found. Please use an existing Python installation.'
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
									'Select an environment type'
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
						'Python Interpreter'
					))()}
				description={(() =>
					localize(
						'pythonInterpreterSubStep.description',
						'Select a Python installation for your project. You can modify this later if you change your mind.'
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
									' will be installed for Python language support.'
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
									'No interpreters available since no environment providers were found.'
								))()}
						</WizardFormattedText>
					) : undefined
				}
			>
				{envSetupType === EnvironmentSetupType.ExistingEnvironment || envProviders.length > 0 ? (
					<DropDownListBox
						keybindingService={keybindingService}
						layoutService={layoutService}
						disabled={!runtimeStartupComplete()}
						title={(() =>
							!runtimeStartupComplete()
								? localize(
									'pythonInterpreterSubStep.dropDown.title.loading',
									'Loading interpreters...'
								)
								: localize(
									'pythonInterpreterSubStep.dropDown.title',
									'Select a Python interpreter'
								))()}
						// TODO: if the runtime startup phase is complete, but there are no suitable
						// interpreters, show a message that no suitable interpreters were found and the
						// user should install an interpreter with minimum version
						entries={
							!runtimeStartupComplete() ? [] : interpreterEntries
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
