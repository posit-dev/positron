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
import { getEnvTypeEntries, getPythonInterpreterEntries, locationForNewEnv } from 'vs/workbench/browser/positronNewProjectWizard/utilities/pythonEnvironmentStepUtils';
import { PositronWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardStep';
import { PositronWizardSubStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardSubStep';
import { DropDownListBox, DropDownListBoxEntry } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { RadioButtonItem } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioButton';
import { RadioGroup } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioGroup';
import { EnvironmentSetupType, LanguageIds, PythonEnvironmentType } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { InterpreterEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/pythonInterpreterEntry';
import { DropdownEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/dropdownEntry';
import { InterpreterInfo, getSelectedInterpreter } from 'vs/workbench/browser/positronNewProjectWizard/utilities/interpreterDropDownUtils';
import { WizardFormattedText, WizardFormattedTextType } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardFormattedText';

/**
 * The PythonEnvironmentStep component is specific to Python projects in the new project wizard.
 * @param props The NewProjectWizardStepProps
 * @returns The rendered component
 */
export const PythonEnvironmentStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	// Retrieve the wizard state and project configuration.
	const newProjectWizardState = useNewProjectWizardContext();
	const setProjectConfig = newProjectWizardState.setProjectConfig;
	const projectConfig = newProjectWizardState.projectConfig;
	const keybindingService = newProjectWizardState.keybindingService;
	const layoutService = newProjectWizardState.layoutService;
	const logService = newProjectWizardState.logService;
	const runtimeStartupService = newProjectWizardState.runtimeStartupService;
	const languageRuntimeService = newProjectWizardState.languageRuntimeService;

	// Hooks to manage the startup phase and interpreter entries.
	const [startupPhase, setStartupPhase] = useState(runtimeStartupService.startupPhase);
	const [envSetupType, setEnvSetupType] = useState(
		projectConfig.pythonEnvSetupType ?? EnvironmentSetupType.NewEnvironment
	);
	const [envType, setEnvType] = useState(
		projectConfig.pythonEnvType ?? PythonEnvironmentType.Venv
	);
	const [interpreterEntries, setInterpreterEntries] =
		useState(
			// It's possible that the runtime discovery phase is not complete, so we need to check
			// for that before creating the interpreter entries.
			startupPhase !== RuntimeStartupPhase.Complete ?
				[] :
				getPythonInterpreterEntries(
					runtimeStartupService,
					languageRuntimeService,
					envSetupType,
					envType
				)
		);
	const [selectedInterpreter, setSelectedInterpreter] = useState(
		getSelectedInterpreter(
			projectConfig.selectedRuntime,
			interpreterEntries,
			runtimeStartupService,
			LanguageIds.Python
		)
	);

	const envTypeEntries = getEnvTypeEntries();

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

	// Utils
	const getInterpreter = (entries: DropDownListBoxEntry<string, InterpreterInfo>[]) => {
		return getSelectedInterpreter(
			selectedInterpreter,
			entries,
			runtimeStartupService,
			LanguageIds.Python
		);
	};

	// Handler for when the environment setup type is selected. If the user selects the "existing
	// environment" setup, the env type dropdown will not show and the interpreter entries will be
	// updated to show all existing interpreters.
	const onEnvSetupSelected = (pythonEnvSetupType: EnvironmentSetupType) => {
		setEnvSetupType(pythonEnvSetupType);
		// If the user selects an existing environment, update the interpreter entries dropdown
		// to show the unfiltered list of all existing interpreters.
		const entries = getPythonInterpreterEntries(
			runtimeStartupService,
			languageRuntimeService,
			pythonEnvSetupType,
			envType
		);
		setInterpreterEntries(entries);
		const selectedRuntime = getInterpreter(entries);
		setSelectedInterpreter(selectedRuntime);
		setProjectConfig({ ...projectConfig, pythonEnvSetupType, selectedRuntime });
	};

	// Handler for when the environment type is selected. The interpreter entries are updated based
	// on the selected environment type, and the project configuration is updated as well.
	const onEnvTypeSelected = (pythonEnvType: PythonEnvironmentType) => {
		setEnvType(pythonEnvType);
		const entries = getPythonInterpreterEntries(
			runtimeStartupService,
			languageRuntimeService,
			envSetupType,
			pythonEnvType
		);
		setInterpreterEntries(entries);
		const selectedRuntime = getInterpreter(entries);
		setSelectedInterpreter(selectedRuntime);
		setProjectConfig({ ...projectConfig, pythonEnvType, selectedRuntime });
	};

	// Handler for when the interpreter is selected. The project configuration is updated with the
	// selected interpreter.
	const onInterpreterSelected = (identifier: string) => {
		const selectedRuntime = languageRuntimeService.getRegisteredRuntime(identifier);
		if (!selectedRuntime) {
			// This shouldn't happen, since the DropDownListBox should only allow selection of registered
			// runtimes
			logService.error(`No runtime found for identifier: ${selectedInterpreter}`);
			return;
		}
		setSelectedInterpreter(selectedRuntime);
		setProjectConfig({ ...projectConfig, selectedRuntime });
		// TODO: if the selected interpreter doesn't have ipykernel installed, show a message and
		// set projectConfig.installIpykernel to true
	};

	// Hook to update the interpreter entries when the runtime discovery phase is complete
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeRuntimeStartupPhase event handler; when the runtime discovery phase
		// is complete, update the interpreter entries.
		disposableStore.add(
			runtimeStartupService.onDidChangeRuntimeStartupPhase(
				phase => {
					if (phase === RuntimeStartupPhase.Complete) {
						const entries = getPythonInterpreterEntries(
							runtimeStartupService,
							languageRuntimeService,
							envSetupType,
							envType
						);
						setInterpreterEntries(entries);
						const selectedRuntime = getInterpreter(entries);
						setSelectedInterpreter(selectedRuntime);
						setProjectConfig({
							...projectConfig,
							pythonEnvType: envType,
							pythonEnvSetupType: envSetupType,
							selectedRuntime
						});
					}
					setStartupPhase(phase);
				}
			)
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	});

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
					description={(() => localize(
						'pythonEnvironmentSubStep.description',
						'Select an environment type for your project.'
					))()}
					feedback={() =>
						<WizardFormattedText type={WizardFormattedTextType.Info}>
							{(() => localize(
								'pythonEnvironmentSubStep.feedback',
								'The environment will be created at: ',
							))()}
							<code>
								{locationForNewEnv(
									projectConfig.parentFolder,
									projectConfig.projectName,
									envType
								)}
							</code>
						</WizardFormattedText>
					}
				>
					<DropDownListBox
						keybindingService={keybindingService}
						layoutService={layoutService}
						title={(() => localize(
							'pythonEnvironmentSubStep.dropDown.title',
							'Select an environment type'
						))()}
						entries={envTypeEntries}
						selectedIdentifier={envType}
						createItem={item =>
							<DropdownEntry
								title={item.options.value.envType}
								subtitle={item.options.value.envDescription}
							/>
						}
						onSelectionChanged={item => onEnvTypeSelected(item.options.identifier)}
					/>
				</PositronWizardSubStep> : null
			}
			{/* TODO: add a tooltip icon to the end of the feedback text of the PositronWizardSubStep */}
			{/*       onhover tooltip, display the following note if we don't detect ipykernel for the selected interpreter */}
			{/*       <p>Note: Positron will install <code>ipykernel</code> in this environment for Python language support.</p> */}
			<PositronWizardSubStep
				title={(() => localize(
					'pythonInterpreterSubStep.title',
					'Python Interpreter'
				))()}
				description={(() => localize(
					'pythonInterpreterSubStep.description',
					'Select a Python installation for your project. You can modify this later if you change your mind.'
				))()}
			>
				<DropDownListBox
					keybindingService={keybindingService}
					layoutService={layoutService}
					disabled={startupPhase !== RuntimeStartupPhase.Complete}
					title={(() => startupPhase !== RuntimeStartupPhase.Complete ?
						localize(
							'pythonInterpreterSubStep.dropDown.title.loading',
							'Loading interpreters...'
						) :
						localize(
							'pythonInterpreterSubStep.dropDown.title',
							'Select a Python interpreter'
						)
					)()}
					// TODO: if the runtime startup phase is complete, but there are no suitable
					// interpreters, show a message that no suitable interpreters were found and the
					// user should install an interpreter with minimum version
					entries={startupPhase !== RuntimeStartupPhase.Complete ? [] : interpreterEntries}
					selectedIdentifier={selectedInterpreter?.runtimeId}
					createItem={item =>
						<InterpreterEntry interpreterInfo={item.options.value} />
					}
					onSelectionChanged={item =>
						onInterpreterSelected(item.options.identifier)
					}
				/>
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
