/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren } from 'react';  // eslint-disable-line no-duplicate-imports
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { NewProjectConfiguration } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardState';
import { NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStep';
import { NewProjectWizardStepLookup } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStepLookup';

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

	return (
		<CurrentStep next={nextHandler} back={backHandler} cancel={props.cancel} accept={acceptHandler} />
	);
};
