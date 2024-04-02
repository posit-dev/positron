/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStepProps';
import { localize } from 'vs/nls';
import { RuntimeStartupPhase } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { createCondaInterpreterDropDownItems, createPythonInterpreterDropDownItems, createVenvInterpreterDropDownItems } from 'vs/workbench/browser/positronNewProjectWizard/utilities/pythonInterpreterListUtils';
import { PositronWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardStep';
import { PositronWizardSubStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardSubStep';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { DropDownListBox } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { RadioButtonItem } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioButton';
import { RadioGroup } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioGroup';
import { EnvironmentSetupType } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';

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
	const [interpreterEntries, setInterpreterEntries] =
		useState(
			// It's possible that the runtime discovery phase is not complete, so we need to check
			// for that before creating the interpreter entries.
			startupPhase !== RuntimeStartupPhase.Complete ?
				[] :
				// TODO: we currently populate the interpreter entries with all registered runtimes,
				// but we'll want to call the Venv or Conda interpreter creation functions based on
				// the default selection.
				createPythonInterpreterDropDownItems(
					newProjectWizardState.runtimeStartupService,
					newProjectWizardState.languageRuntimeService
				)
		);
	const [envSetupType, setEnvSetupType] = useState(EnvironmentSetupType.NewEnvironment);

	// TODO: retrieve the python environment types from the language runtime service somehow?
	// TODO: localize these entries
	const envTypeEntries = [
		new DropDownListBoxItem({ identifier: 'Venv', title: 'Venv' + ' Creates a `.venv` virtual environment for your project' }),
		new DropDownListBoxItem({ identifier: 'Conda', title: 'Conda' + ' Creates a `.conda` Conda environment for your project' })
	];

	const envSetupRadioButtons: RadioButtonItem[] = [
		new RadioButtonItem({ identifier: EnvironmentSetupType.NewEnvironment, title: 'Create a new Python environment _(Recommended)_' }),
		new RadioButtonItem({ identifier: EnvironmentSetupType.ExistingEnvironment, title: 'Use an existing Python installation' })
	];

	// Handler for when the environment setup type is selected. If the user selects the "existing
	// environment" setup, the env type dropdown will not show and the interpreter entries will be
	// updated to show all existing interpreters.
	const onEnvSetupSelected = (identifier: string) => {
		// Verify that the identifier is a valid EnvironmentSetupType value
		if (Object.values(EnvironmentSetupType).includes(identifier as EnvironmentSetupType)) {
			setEnvSetupType(identifier as EnvironmentSetupType);
			// If the user selects an existing environment, update the interpreter entries dropdown
			// to show the unfiltered list of all existing interpreters.
			if (identifier === EnvironmentSetupType.ExistingEnvironment) {
				setInterpreterEntries(
					createPythonInterpreterDropDownItems(
						newProjectWizardState.runtimeStartupService,
						newProjectWizardState.languageRuntimeService
					)
				);
			}
		} else {
			// This shouldn't happen, since the RadioGroup should only allow selection of the
			// EnvironmentSetupType values
			logService.error(`Unknown environment setup type: ${identifier}`);
		}
	};

	// Handler for when the environment type is selected. The interpreter entries are updated based
	// on the selected environment type, and the project configuration is updated as well.
	const onEnvTypeSelected = (identifier: string) => {
		switch (identifier) {
			case 'Venv':
				setInterpreterEntries(createVenvInterpreterDropDownItems(newProjectWizardState.runtimeStartupService, newProjectWizardState.languageRuntimeService));
				break;
			case 'Conda':
				setInterpreterEntries(createCondaInterpreterDropDownItems());
				break;
			default:
				logService.error(`Unknown environment type: ${identifier}`);
		}
		setProjectConfig({ ...projectConfig, pythonEnvType: identifier });
	};

	// Handler for when the interpreter is selected. The project configuration is updated with the
	// selected interpreter.
	const onInterpreterSelected = (identifier: string) => {
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
						// TODO: instead of calling createPythonInterpreterComboBoxItems, it should
						// be aware of the defaults set by the environment type (Venv, Conda)
						setInterpreterEntries(
							createPythonInterpreterDropDownItems(
								newProjectWizardState.runtimeStartupService,
								newProjectWizardState.languageRuntimeService
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
				))(),
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
					initialSelectionId={EnvironmentSetupType.NewEnvironment}
					onSelectionChanged={identifier => onEnvSetupSelected(identifier)}
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
					// TODO: construct the env location based on the envTypeEntries above, instead of inline here
					feedback={(() => localize(
					'pythonEnvironmentSubStep.feedback',
					'The {0} environment will be created at: {1}',
					projectConfig.pythonEnvType,
					`${projectConfig.parentFolder}/${projectConfig.projectName}/${projectConfig.pythonEnvType === 'Venv' ? '.venv' : 'Conda' ? '.conda' : ''}`
				))()}
				>
					{/* TODO: how to pre-select an option? */}
					<DropDownListBox
						keybindingService={keybindingService}
						layoutService={layoutService}
						title={(() => localize(
						'pythonEnvironmentSubStep.dropDown.title',
						'Select an environment type'
					))()}
						entries={envTypeEntries}
						onSelectionChanged={identifier => onEnvTypeSelected(identifier)}
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
				{startupPhase !== RuntimeStartupPhase.Complete ?
					// TODO: how to disable clicking on the combo box while loading?
					<DropDownListBox
						keybindingService={keybindingService}
						layoutService={layoutService}
						title={(() => localize(
							'pythonInterpreterSubStep.dropDown.title.loading',
							'Loading interpreters...'
						))()}
						entries={[]}
						onSelectionChanged={() => { }}
					/> : null
				}
				{startupPhase === RuntimeStartupPhase.Complete ?
					// TODO: how to pre-select an option?
					<DropDownListBox
						keybindingService={keybindingService}
						layoutService={layoutService}
						title={(() => localize(
							'pythonInterpreterSubStep.dropDown.title',
							'Select a Python interpreter'
						))()}
						// TODO: if the runtime startup phase is complete, but there are no suitable interpreters, show a message
						// that no suitable interpreters were found and the user should install an interpreter with minimum version
						entries={interpreterEntries}
						onSelectionChanged={identifier => onInterpreterSelected(identifier)}
					/> : null
				}
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
