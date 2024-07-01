/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { NewProjectWizardStepLookup } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStepLookup';

interface NewProjectWizardStepContainerProps {
	cancel: () => void;
	accept: () => void;
}

export const NewProjectWizardStepContainer = (props: PropsWithChildren<NewProjectWizardStepContainerProps>) => {
	const context = useNewProjectWizardContext();
	const [currentStep, setCurrentStep] = useState(() => context.currentStep);
	const WizardStep = NewProjectWizardStepLookup[currentStep];

	const nextHandler = (step: NewProjectWizardStep) => {
		setCurrentStep(context.goToNextStep(step));
	};

	const backHandler = () => {
		setCurrentStep(context.goToPreviousStep());
	};

	return (
		<WizardStep next={nextHandler} back={backHandler} cancel={props.cancel} accept={props.accept} />
	);
};
