/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { PropsWithChildren, useRef } from 'react';
import { PositronWizardStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardStep';
import { PositronWizardSubStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardSubStep';
import { LabeledTextInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledTextInput';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardContext';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardStepProps';
import { localize } from 'vs/nls';
import { ComboBox } from 'vs/base/browser/ui/positronComponents/comboBox/comboBox';
import { RuntimeStartupPhase } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { ComboBoxMenuItem } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxMenuItem';
import { ComboBoxMenuSeparator } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxMenuSeparator';

export const PythonEnvironmentStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	const newProjectWizardState = useNewProjectWizardContext();
	const projectConfig = newProjectWizardState.projectConfig;
	const keybindingService = newProjectWizardState.keybindingService;
	const layoutService = newProjectWizardState.layoutService;

	let interpreterComboBoxTitle = 'Loading interpreters...';
	const interpreterEntries = useRef<(ComboBoxMenuItem | ComboBoxMenuSeparator)[]>([]);


	// HELP
	// This is not re-rendering the dropdown when the runtime discovery is complete
	if (newProjectWizardState.runtimeStartupService.startupPhase === RuntimeStartupPhase.Complete) {
		// newProjectWizardState.runtimeStartupService.getPreferredRuntime('python');
		// See ILanguageRuntimeMetadata in src/vs/workbench/services/languageRuntime/common/languageRuntimeService.ts
		// for the properties of the runtime metadata object
		const discoveredRuntimes = newProjectWizardState.languageRuntimeService.registeredRuntimes;
		const pythonRuntimes = discoveredRuntimes.filter(runtime => runtime.languageId === 'python');
		interpreterEntries.current = pythonRuntimes.map((runtime) => {
			return new ComboBoxMenuItem({
				identifier: runtime.runtimeId,
				label: `${runtime.languageName} ${runtime.languageVersion} ---- ${runtime.runtimePath} ---- ${runtime.runtimeSource}`
			});
		});
		interpreterComboBoxTitle = 'Select a Python interpreter';
	} else {
		console.log('Python runtime discovery is not yet complete');
	}

	const acceptHandler = () => {
		// TODO: set the python interpreter and environment type in the projectConfig
		props.accept();
	};

	return (
		<PositronWizardStep
			title={localize('pythonEnvironmentStep.title', 'Set up Python environment')}
			backButtonConfig={{ onClick: props.back }}
			cancelButtonConfig={{ onClick: props.cancel }}
			okButtonConfig={{ onClick: acceptHandler }}
		>
			<PositronWizardSubStep
				title={localize('pythonEnvironmentSubStep.howToSetUpEnv', 'How would you like to set up your Python project environment?')}
			>
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
				// title='Python Environment'
				feedback={`The Venv environment will be created at: ${projectConfig.parentFolder}/${projectConfig.projectName}/.venv`}
			>
				<LabeledTextInput
					label='Select an environment type for your project'
					autoFocus
					value={'Venv'}
					onChange={e => console.log('python env type', e)}
				/>
			</PositronWizardSubStep>
			{/* onhover tooltip, display the following note if we don't detect ipykernel for the selected interpreter */}
			{/* <p>Note: Positron will install <code>ipykernel</code> in this environment for Python language support.</p> */}
			<PositronWizardSubStep
				title='Python Interpreter'
				description={localize('pythonInterpreter.comboBoxTitle', 'Select a Python installation for your project. You can modify this later if you change your mind.')}
			>
				<ComboBox
					keybindingService={keybindingService}
					layoutService={layoutService}
					className='combo-box'
					title={interpreterComboBoxTitle}
					entries={interpreterEntries.current}
					onSelectionChanged={identifier => console.log(`Python interpreter changed to ${identifier}`)}
				/>

			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
