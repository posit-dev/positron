/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { PropsWithChildren } from 'react';
import { PositronWizardStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardStep';
import { PositronWizardSubStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardSubStep';
import { LabeledTextInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledTextInput';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardContext';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardStepProps';

export const PythonEnvironmentStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	const newProjectWizardState = useNewProjectWizardContext();
	const projectConfig = newProjectWizardState.projectConfig;

	// TODO: set the python interpreter and environment type

	return (
		<PositronWizardStep
			title='Set up project environment'
			backButtonConfig={{ onClick: props.back }}
			cancelButtonConfig={{ onClick: props.cancel }}
			okButtonConfig={{ onClick: props.accept }}
		>
			<PositronWizardSubStep
				title='Python Interpreter'
			// description='Select a Python interpreter for your project. You can modify this later if you change your mind.'
			>
				<LabeledTextInput
					label='Select a Python interpreter for your project. You can modify this later if you change your mind'
					autoFocus
					value={''}
					onChange={e => console.log('python interpreter', e)}
				/>
			</PositronWizardSubStep>
			<PositronWizardSubStep
				// title='Python Environment'
				feedback={`The Venv environment will be created at: ${projectConfig.parentFolder}/${projectConfig.projectName}/.venv`}
			>
				<LabeledTextInput
					label='Python Environment'
					autoFocus
					value={'Create new environment'}
					onChange={e => console.log('create or reuse existing env', e)}
				/>
				<LabeledTextInput
					label='Select an environment type for your project'
					autoFocus
					value={'Venv'}
					onChange={e => console.log('python interpreter', e)}
				/>
			</PositronWizardSubStep>
			{/* Display the following note if we don't detect ipykernel for the selected interpreter */}
			<p>Note: Positron will install <code>ipykernel</code> in this environment for Python language support.</p>
		</PositronWizardStep>
	);
};
