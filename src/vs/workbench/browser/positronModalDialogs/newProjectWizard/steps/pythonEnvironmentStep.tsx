/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { PropsWithChildren, useEffect, useState } from 'react';
import { PositronWizardStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardStep';
import { PositronWizardSubStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardSubStep';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardContext';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardStepProps';
import { localize } from 'vs/nls';
import { ComboBox } from 'vs/base/browser/ui/positronComponents/comboBox/comboBox';
import { RuntimeStartupPhase } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { ComboBoxMenuItem } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxMenuItem';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { createCondaInterpreterComboBoxItems, createPythonInterpreterComboBoxItems, createVenvInterpreterComboBoxItems } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/pythonInterpreterListUtils';

export const PythonEnvironmentStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	const newProjectWizardState = useNewProjectWizardContext();
	const setProjectConfig = newProjectWizardState.setProjectConfig;
	const projectConfig = newProjectWizardState.projectConfig;
	const keybindingService = newProjectWizardState.keybindingService;
	const layoutService = newProjectWizardState.layoutService;

	const [startupPhase, setStartupPhase] =
		useState(newProjectWizardState.runtimeStartupService.startupPhase);

	// TODO: we will probably default to Venv as the environment type, so we'll want to filter
	// the interpreter entries to PythonRuntimeFilter.Global
	const [interpreterEntries, setInterpreterEntries] =
		useState(
			startupPhase !== RuntimeStartupPhase.Complete ?
				[] :
				createPythonInterpreterComboBoxItems(
					newProjectWizardState.runtimeStartupService,
					newProjectWizardState.languageRuntimeService
				)
		);

	// TODO: retrieve the python environment types from the language runtime service somehow?
	const envTypeEntries = [
		new ComboBoxMenuItem({ identifier: 'Venv', label: 'Venv' + ' Creates a `.venv` virtual environment for your project' }),
		new ComboBoxMenuItem({ identifier: 'Conda', label: 'Conda' + ' Creates a `.conda` Conda environment for your project' })
	];

	// // TODO: hook this up to the radio buttons
	// const onEnvSetupSelected = (identifier: string) => {
	// 	// TODO: update the interpreter entries, filtering with PythonRuntimeFilter.All if existing python installation is selected
	// };

	const onEnvTypeSelected = (identifier: string) => {
		switch (identifier) {
			case 'Venv':
				setInterpreterEntries(createVenvInterpreterComboBoxItems(newProjectWizardState.runtimeStartupService, newProjectWizardState.languageRuntimeService));
				break;
			case 'Conda':
				setInterpreterEntries(createCondaInterpreterComboBoxItems());
				break;
			default:
				console.error(`Unknown environment type: ${identifier}`);
		}
		setProjectConfig({ ...projectConfig, pythonEnvType: identifier });
	};

	const onInterpreterSelected = (identifier: string) => {
		const selectedRuntime = newProjectWizardState.languageRuntimeService.getRegisteredRuntime(identifier);
		console.log(`Python interpreter selected: ${selectedRuntime}`);
		if (!selectedRuntime) {
			// This shouldn't happen, since the ComboBox should only allow selection of registered runtimes
			console.error(`No runtime found for identifier: ${identifier}`);
			return;
		}
		setProjectConfig({ ...projectConfig, selectedRuntime });
	};

	// Hook to update the interpreter entries when the runtime discovery phase is complete
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(
			newProjectWizardState.runtimeStartupService.onDidChangeRuntimeStartupPhase(
				phase => {
					console.log('Python runtime discovery phase:', phase);
					if (phase === RuntimeStartupPhase.Complete) {
						// TODO: instead of call this directly, it should be aware of the defaults set by the environment type
						setInterpreterEntries(createPythonInterpreterComboBoxItems(newProjectWizardState.runtimeStartupService, newProjectWizardState.languageRuntimeService));
					}
					setStartupPhase(phase);
				}
			)
		);
		return () => disposableStore.dispose();
	});

	return (
		<PositronWizardStep
			title={localize('pythonEnvironmentStep.title', 'Set up Python environment')}
			backButtonConfig={{ onClick: props.back }}
			cancelButtonConfig={{ onClick: props.cancel }}
			okButtonConfig={{ onClick: props.accept }}
		>
			<PositronWizardSubStep
				title={localize('pythonEnvironmentSubStep.howToSetUpEnv', 'How would you like to set up your Python project environment?')}
			>
				{/* TODO: create radiogroup and radiobutton components */}
				<div style={{ display: 'flex', flexDirection: 'column', rowGap: '4px' }}>
					<div>
						<input type='radio' id='newEnvironment' name='envSetup' value='Create a new Python environment <i>(Recommended)' checked />
						<label htmlFor='newEnvironment'>Create a new Python environment <i>(Recommended)</i></label>
					</div>
					<div>
						<input type='radio' id='existingInstallation' name='envSetup' value='Use an existing Python installation' />
						<label htmlFor='existingInstallation'>Use an existing Python installation</label>
					</div>
				</div>
			</PositronWizardSubStep>
			<PositronWizardSubStep
				title='Python Environment'
				description='Select an environment type for your project.'
				feedback={`The ${projectConfig.pythonEnvType} environment will be created at: ${projectConfig.parentFolder}/${projectConfig.projectName}/${projectConfig.pythonEnvType === 'Venv' ? '.venv' : '.conda'}`}
			>
				<ComboBox
					keybindingService={keybindingService}
					layoutService={layoutService}
					className='combo-box'
					title='Select an environment type'
					entries={envTypeEntries}
					onSelectionChanged={identifier => onEnvTypeSelected(identifier)}
				/>
			</PositronWizardSubStep>
			{/* onhover tooltip, display the following note if we don't detect ipykernel for the selected interpreter */}
			{/* <p>Note: Positron will install <code>ipykernel</code> in this environment for Python language support.</p> */}
			<PositronWizardSubStep
				title='Python Interpreter'
				description={localize('pythonInterpreter.comboBoxTitle', 'Select a Python installation for your project. You can modify this later if you change your mind.')}
			>
				{startupPhase !== RuntimeStartupPhase.Complete && (
					<ComboBox
						keybindingService={keybindingService}
						layoutService={layoutService}
						className='combo-box'
						title='Loading interpreters...'
						entries={[]}
						onSelectionChanged={() => { }}
					/>
				)}
				{startupPhase === RuntimeStartupPhase.Complete && (
					<ComboBox
						keybindingService={keybindingService}
						layoutService={layoutService}
						className='combo-box'
						title='Select a Python interpreter'
						entries={interpreterEntries}
						onSelectionChanged={identifier => onInterpreterSelected(identifier)}
					/>
				)}
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
