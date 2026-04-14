/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './newDataConnectionFlow.css';

// React.
import { useCallback, useState } from 'react';

// Other dependencies.
import { ConfigureDataConnection } from './configureDataConnection.js';
import { SelectDataConnectionProvider } from './selectDataConnectionProvider.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';

/**
 * NewDataConnectionFlowStep enumeration.
 */
enum NewDataConnectionFlowStep {
	/**
	 * The user is selecting a data connection provider from the list of registered drivers.
	 */
	SelectProvider,

	/**
	 * The user is configuring the connection settings for the selected provider.
	 */
	Configure,
}

/**
 * NewDataConnectionFlowProps interface.
 */
interface NewDataConnectionFlowProps {
	// The renderer.
	renderer: PositronModalReactRenderer;

	// The data connections service.
	positronDataConnectionsService: IPositronDataConnectionsService;
}

/**
 * NewDataConnectionFlow component.
 * Manages the forward/back transitions between the select provider and configure dialogs using a
 * single renderer so the background dimming does not flicker.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const NewDataConnectionFlow = (props: NewDataConnectionFlowProps) => {
	// State.
	const [step, setStep] = useState(NewDataConnectionFlowStep.SelectProvider);
	const [dataConnectionProfile, setDataConnectionProfile] = useState<IDataConnectionProfile | undefined>(undefined);

	// Next handler. Transitions from the select provider step to the configure step.
	const nextHandler = useCallback((driverId: string) => {
		// Initialize the data connection profile with the selected driver ID and empty parameter values.
		setDataConnectionProfile({
			connectionName: '',
			driverId,
			parameterValues: {}
		});

		// Transition to the configure step.
		setStep(NewDataConnectionFlowStep.Configure);
	}, []);

	// Back handler. Transitions from the configure step back to the select provider step.
	const backHandler = useCallback(() => {
		// Transition to the select provider step.
		setStep(NewDataConnectionFlowStep.SelectProvider);
	}, []);

	// Render the current step.
	switch (step) {
		// Step 1: Select provider.
		case NewDataConnectionFlowStep.SelectProvider:
			return (
				<SelectDataConnectionProvider
					positronDataConnectionsService={props.positronDataConnectionsService}
					renderer={props.renderer}
					onNext={nextHandler}
				/>
			);

		// Step 2: Configure connection.
		case NewDataConnectionFlowStep.Configure:
			return (
				<ConfigureDataConnection
					dataConnectionProfile={dataConnectionProfile!}
					renderer={props.renderer}
					onBack={backHandler}
				/>
			);
	}
};
