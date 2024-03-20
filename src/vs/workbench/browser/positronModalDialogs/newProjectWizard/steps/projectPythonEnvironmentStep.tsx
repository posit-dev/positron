/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// // import 'vs/css!./projectNameLocationStep';
// const React = require('react');
// import { PropsWithChildren, useState } from 'react';
// import { localize } from 'vs/nls';
// import { PositronWizardStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardStep';
// import { PositronWizardSubStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardSubStep';
// import { Checkbox } from 'vs/base/browser/ui/positronModalDialog/components/checkbox';
// import { LabeledFolderInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledFolderInput';
// import { LabeledTextInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledTextInput';

// interface ProjectNameLocationStepProps {
// 	cancel: () => void;
// 	next: () => void;
// }

// const projNameAndLocStep = (props: PropsWithChildren<>) => {

// 	return (
// 		<PositronWizardStep
// 			title='Set up project environment'
// 			currentStep={currentStep}
// 			totalSteps={totalSteps}
// 			okButtonTitle={okButtonTitle}
// 			accept={acceptHandler}
// 			cancel={cancelHandler}
// 			back={backHandler}
// 			next={nextHandler}
// 		>
// 			<PositronWizardSubStep
// 				title='Python Interpreter'
// 			// description='Select a Python interpreter for your project. You can modify this later if you change your mind.'
// 			>
// 				<LabeledTextInput
// 					label='Select a Python interpreter for your project. You can modify this later if you change your mind'
// 					autoFocus
// 					value={''}
// 					onChange={e => console.log('python interpreter', e)}
// 				/>
// 			</PositronWizardSubStep>
// 			<PositronWizardSubStep
// 				// title='Python Environment'
// 				feedback={`The Venv environment will be created at: ${newProjectResult.parentFolder}/${newProjectResult.projectName}/.venv`}
// 			>
// 				<LabeledTextInput
// 					label='Python Environment'
// 					autoFocus
// 					value={'Create new environment'}
// 					onChange={e => console.log('create or reuse existing env', e)}
// 				/>
// 				<LabeledTextInput
// 					label='Select an environment type for your project'
// 					autoFocus
// 					value={'Venv'}
// 					onChange={e => console.log('python interpreter', e)}
// 				/>
// 			</PositronWizardSubStep>
// 			{/* Display the following note if we don't detect ipykernel for the selected interpreter */}
// 			<p>Note: Positron will install <code>ipykernel</code> in this environment for Python language support.</p>
// 		</PositronWizardStep>
// );
// }

// export const ProjectNameLocationStep = (props: PropsWithChildren<ProjectNameLocationStepProps>) => {
// 	// Depending on the project type selected, return the component for that project type


// };

// export default ProjectNameLocationStep;
