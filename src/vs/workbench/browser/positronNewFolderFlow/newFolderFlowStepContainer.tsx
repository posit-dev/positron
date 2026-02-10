/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { PropsWithChildren, useState } from 'react';

// Other dependencies.
import { useNewFolderFlowContext } from './newFolderFlowContext.js';
import { NewFolderFlowStep } from './interfaces/newFolderFlowEnums.js';
import { NewFolderFlowStepLookup } from './interfaces/newFolderFlowStepLookup.js';

interface NewFolderFlowStepContainerProps {
	cancel: () => void;
	accept: () => void;
}

export const NewFolderFlowStepContainer = (props: PropsWithChildren<NewFolderFlowStepContainerProps>) => {
	const context = useNewFolderFlowContext();
	const [currentStep, setCurrentStep] = useState(() => context.currentStep);
	const FlowStep = NewFolderFlowStepLookup[currentStep];

	const nextHandler = (step: NewFolderFlowStep) => {
		setCurrentStep(context.goToNextStep(step));
	};

	const backHandler = () => {
		setCurrentStep(context.goToPreviousStep());
	};

	return (
		<FlowStep accept={props.accept} back={backHandler} cancel={props.cancel} next={nextHandler} />
	);
};
