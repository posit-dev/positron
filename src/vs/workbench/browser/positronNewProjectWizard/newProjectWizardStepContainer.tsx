/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, useState } from 'react';

// Other dependencies.
import { useNewProjectWizardContext } from './newProjectWizardContext.js';
import { NewProjectWizardStep } from './interfaces/newProjectWizardEnums.js';
import { NewProjectWizardStepLookup } from './interfaces/newProjectWizardStepLookup.js';

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
		<WizardStep accept={props.accept} back={backHandler} cancel={props.cancel} next={nextHandler} />
	);
};
