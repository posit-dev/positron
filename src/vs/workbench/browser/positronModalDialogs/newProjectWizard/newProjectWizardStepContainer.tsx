/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { PropsWithChildren } from 'react';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardContext';
import { NewProjectConfiguration } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardState';
import { NewProjectWizardStep } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardStep';
import { NewProjectWizardStepLookup } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardStepLookup';

interface NewProjectWizardStepContainerProps {
	cancel: () => void;
	accept: (projectConfig: NewProjectConfiguration) => void;
}

export const NewProjectWizardStepContainer = (props: PropsWithChildren<NewProjectWizardStepContainerProps>) => {
	const newProjectWizardState = useNewProjectWizardContext();
	const CurrentStep = NewProjectWizardStepLookup[newProjectWizardState.currentStep];

	const nextHandler = (step: NewProjectWizardStep) => {
		newProjectWizardState.goToNextStep(step);
	};

	const backHandler = () => {
		newProjectWizardState.goToPreviousStep();
	};

	const acceptHandler = () => {
		props.accept(newProjectWizardState.projectConfig);
	};

	// useEffect(() => {
	// 	console.log('NewProjectWizardStepContainer useEffect');
	// 	console.log('\tnewProjectWizardState.currentStep: ' + newProjectWizardState.currentStep);
	// 	console.log('\tnewProjectWizardState.projectConfig', newProjectWizardState.projectConfig);
	// 	console.log('\tnewProjectWizardState.wizardSteps', newProjectWizardState.wizardSteps);
	// }, [newProjectWizardState]);

	return (
		<CurrentStep next={nextHandler} back={backHandler} cancel={props.cancel} accept={acceptHandler} />
	);
};
