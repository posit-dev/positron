/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { PropsWithChildren } from 'react';
import { localize } from 'vs/nls';
import { PositronWizardStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardStep';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardContext';
import { URI } from 'vs/base/common/uri';
import { PositronWizardSubStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardSubStep';
import { LabeledTextInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledTextInput';
import { LabeledFolderInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledFolderInput';
import { Checkbox } from 'vs/base/browser/ui/positronModalDialog/components/checkbox';
import { NewProjectWizardStep } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardStep';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardStepProps';

export const ProjectNameLocationStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	const newProjectWizardState = useNewProjectWizardContext();
	const projectConfig = newProjectWizardState.projectConfig;
	const setProjectConfig = newProjectWizardState.setProjectConfig;
	const fileDialogs = newProjectWizardState.fileDialogService;
	// const projectNameRef = useRef<HTMLInputElement>(projectConfig.projectName);

	// The browse handler.
	const browseHandler = async () => {
		// Show the open dialog.
		const uri = await fileDialogs.showOpenDialog({
			defaultUri: URI.file(projectConfig.parentFolder),
			canSelectFiles: false,
			canSelectFolders: true
		});

		// If the user made a selection, set the parent directory.
		if (uri?.length) {
			setProjectConfig({ ...projectConfig, parentFolder: uri[0].fsPath });
			// projectNameRef.current.focus();
		}
	};

	const next = () => {
		props.next(NewProjectWizardStep.PythonEnvironment);
	};

	return (
		<PositronWizardStep
			title={localize('projectNameLocationStep.title', 'Set project name and location')}
			cancelButtonConfig={{ onClick: props.cancel }}
			nextButtonConfig={{ onClick: next }}
			backButtonConfig={{ onClick: props.back }}
		>
			<PositronWizardSubStep
				title={localize('projectNameLocationSubStep.projectName', 'Project Name')}
			// description={'Enter a name for your new ' + newProjectResult.projectType}
			>
				<LabeledTextInput
					// ref={projectNameRef}
					label={`Enter a name for your new ${projectConfig.projectType}`}
					autoFocus
					value={projectConfig.projectName}
					onChange={e => setProjectConfig({ ...projectConfig, projectName: e.target.value })}
				/>
			</PositronWizardSubStep>
			<PositronWizardSubStep
				title={localize('projectNameLocationSubStep.parentDirectory', 'Parent Directory')}
				// description='Select a directory to create your project in.'
				feedback={'Your project will be created at: ' + projectConfig.parentFolder + '/' + projectConfig.projectName}
			>
				<LabeledFolderInput
					label='Select a directory to create your project in'
					value={projectConfig.parentFolder} // this should be <code>formatted
					onBrowse={browseHandler}
					onChange={e => setProjectConfig({ ...projectConfig, parentFolder: e.target.value })}
				/>
				{/* <div style={{ marginBottom: '16px' }}>
					Your project will be created at:&nbsp;
					<span style={{ fontFamily: 'monospace', color: '#D7BA7D' }}>
						{newProjectResult.parentFolder + '/' + newProjectResult.projectName}
					</span>
				</div> */}
			</PositronWizardSubStep>
			<PositronWizardSubStep>
				<Checkbox label='Initialize project as git repository' onChanged={checked => setProjectConfig({ ...projectConfig, initGitRepo: checked })} />
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
