/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { PropsWithChildren, useEffect } from 'react';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardContext';
import { NewProjectConfiguration } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardState';
import { NewProjectWizardStep, NewProjectWizardSteps } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardSteps';

interface NewProjectWizardStepContainerProps {
	cancel: () => void;
	accept: (projectConfig: NewProjectConfiguration) => void;
}

export interface NewProjectWizardCurrentStepProps {
	cancel: () => void;
	accept: () => void;
	next: (step: NewProjectWizardStep) => void;
	back: () => void;
}

export const NewProjectWizardStepContainer = (props: PropsWithChildren<NewProjectWizardStepContainerProps>) => {
	// Hooks.
	const newProjectWizardState = useNewProjectWizardContext();
	const CurrentStep = NewProjectWizardSteps[newProjectWizardState.currentStep];

	const nextHandler = (step: NewProjectWizardStep) => {
		newProjectWizardState.goToNextStep(step);
	};

	const backHandler = () => {
		newProjectWizardState.goToPreviousStep();
	};

	const acceptHandler = () => {
		// console.log('handling accept in NewProjectWizardStepContainer');
		// console.log(newProjectWizardState);
		props.accept(newProjectWizardState.projectConfig);
	};

	useEffect(() => {
		console.log('NewProjectWizardStepContainer useEffect');
		console.log('\tnewProjectWizardState.currentStep: ' + newProjectWizardState.currentStep);
		console.log('\tnewProjectWizardState.projectConfig', newProjectWizardState.projectConfig);
		console.log('\tnewProjectWizardState.wizardSteps', newProjectWizardState.wizardSteps);
	}, [newProjectWizardState]);

	return (
		<CurrentStep next={nextHandler} back={backHandler} cancel={props.cancel} accept={acceptHandler} />
	);
};
