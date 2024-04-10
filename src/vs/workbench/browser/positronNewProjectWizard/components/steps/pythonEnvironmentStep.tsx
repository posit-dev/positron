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
import { getPythonInterpreterEntries, getSelectedPythonInterpreterId, locationForNewEnv } from 'vs/workbench/browser/positronNewProjectWizard/utilities/pythonEnvironmentStepUtils';
import { PositronWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardStep';
import { PositronWizardSubStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardSubStep';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { DropDownListBox } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { RadioButtonItem } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioButton';
import { RadioGroup } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioGroup';
import { EnvironmentSetupType, PythonEnvironmentType } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { PythonInterpreterEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/pythonInterpreterEntry';
import { DropdownEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/dropdownEntry';

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

	// Hooks to manage the startup phase and interpreter entries.
	const [startupPhase, setStartupPhase] =
		useState(newProjectWizardState.runtimeStartupService.startupPhase);
	const [envSetupType, setEnvSetupType] = useState(projectConfig.pythonEnvSetupType);
	const [envType, setEnvType] = useState(projectConfig.pythonEnvType);
	const [selectedInterpreter, setSelectedInterpreter] = useState<string | undefined>(
		getSelectedPythonInterpreterId(
			projectConfig.selectedRuntime?.runtimeId,
			newProjectWizardState.runtimeStartupService
		)
	);
	const [interpreterEntries, setInterpreterEntries] =
		useState(
			// It's possible that the runtime discovery phase is not complete, so we need to check
			// for that before creating the interpreter entries.
			startupPhase !== RuntimeStartupPhase.Complete ?
				[] :
				getPythonInterpreterEntries(
					newProjectWizardState.runtimeStartupService,
					newProjectWizardState.languageRuntimeService,
					envSetupType,
					envType
				)
		);

	// TODO: retrieve the python environment types from the language runtime service somehow?
	// TODO: localize these entries
	const envTypeEntries = [
		new DropDownListBoxItem({ identifier: PythonEnvironmentType.Venv, title: PythonEnvironmentType.Venv + ' Creates a `.venv` virtual environment for your project', value: PythonEnvironmentType.Venv }),
		new DropDownListBoxItem({ identifier: PythonEnvironmentType.Conda, title: PythonEnvironmentType.Conda + ' Creates a `.conda` Conda environment for your project', value: PythonEnvironmentType.Conda })
	];

	const envSetupRadioButtons: RadioButtonItem[] = [
		new RadioButtonItem({ identifier: EnvironmentSetupType.NewEnvironment, title: 'Create a new Python environment _(Recommended)_' }),
		new RadioButtonItem({ identifier: EnvironmentSetupType.ExistingEnvironment, title: 'Use an existing Python installation' })
	];

	// Handler for when the environment setup type is selected. If the user selects the "existing
	// environment" setup, the env type dropdown will not show and the interpreter entries will be
	// updated to show all existing interpreters.
	const onEnvSetupSelected = (pythonEnvSetupType: EnvironmentSetupType) => {
		setEnvSetupType(pythonEnvSetupType);
		// If the user selects an existing environment, update the interpreter entries dropdown
		// to show the unfiltered list of all existing interpreters.
		setInterpreterEntries(
			getPythonInterpreterEntries(
				newProjectWizardState.runtimeStartupService,
				newProjectWizardState.languageRuntimeService,
				pythonEnvSetupType,
				envType
			)
		);
		setSelectedInterpreter(
			getSelectedPythonInterpreterId(
				projectConfig.selectedRuntime?.runtimeId,
				newProjectWizardState.runtimeStartupService
			)
		);
		setProjectConfig({ ...projectConfig, pythonEnvSetupType });
	};

	// Handler for when the environment type is selected. The interpreter entries are updated based
	// on the selected environment type, and the project configuration is updated as well.
	const onEnvTypeSelected = (pythonEnvType: PythonEnvironmentType) => {
		setEnvType(pythonEnvType);
		setInterpreterEntries(
			getPythonInterpreterEntries(
				newProjectWizardState.runtimeStartupService,
				newProjectWizardState.languageRuntimeService,
				envSetupType,
				pythonEnvType
			)
		);
		setSelectedInterpreter(
			getSelectedPythonInterpreterId(
				projectConfig.selectedRuntime?.runtimeId,
				newProjectWizardState.runtimeStartupService
			)
		);
		setProjectConfig({ ...projectConfig, pythonEnvType });
	};

	// Handler for when the interpreter is selected. The project configuration is updated with the
	// selected interpreter.
	const onInterpreterSelected = (identifier: string) => {
		setSelectedInterpreter(identifier);
		const selectedRuntime = newProjectWizardState.languageRuntimeService.getRegisteredRuntime(identifier);
		if (!selectedRuntime) {
			// This shouldn't happen, since the DropDownListBox should only allow selection of registered
			// runtimes
			logService.error(`No runtime found for identifier: ${identifier}`);
			return;
		}
		setProjectConfig({ ...projectConfig, selectedRuntime });

		// TODO: if the selected interpreter doesn't have ipykernel installed, show a message
	};

	// Hook to update the interpreter entries when the runtime discovery phase is complete
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeRuntimeStartupPhase event handler; when the runtime discovery phase
		// is complete, update the interpreter entries.
		disposableStore.add(
			newProjectWizardState.runtimeStartupService.onDidChangeRuntimeStartupPhase(
				phase => {
					if (phase === RuntimeStartupPhase.Complete) {
						const entries = getPythonInterpreterEntries(
							newProjectWizardState.runtimeStartupService,
							newProjectWizardState.languageRuntimeService,
							envSetupType,
							envType
						);
						setInterpreterEntries(entries);
						setSelectedInterpreter(
							getSelectedPythonInterpreterId(
								projectConfig.selectedRuntime?.runtimeId,
								newProjectWizardState.runtimeStartupService
							)
						);
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
				))()
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
					initialSelectionId={projectConfig.pythonEnvSetupType}
					onSelectionChanged={identifier => onEnvSetupSelected(identifier as EnvironmentSetupType)}
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
					feedback={(() => localize(
						'pythonEnvironmentSubStep.feedback',
						'The {0} environment will be created at: {1}',
						envType,
						locationForNewEnv(projectConfig.parentFolder, projectConfig.projectName, envType)
					))()}
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
						createItem={dropDownListBoxItem => <DropdownEntry title={dropDownListBoxItem.options.title} subtitle='' />}
						onSelectionChanged={dropDownListBoxItem => onEnvTypeSelected(dropDownListBoxItem.options.identifier)}
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
					selectedIdentifier={selectedInterpreter}
					createItem={dropDownListBoxItem =>
						<PythonInterpreterEntry pythonInterpreterInfo={dropDownListBoxItem.options.value} />
					}
					onSelectionChanged={dropDownListBoxItem =>
						onInterpreterSelected(dropDownListBoxItem.options.identifier)
					}
				/>
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
