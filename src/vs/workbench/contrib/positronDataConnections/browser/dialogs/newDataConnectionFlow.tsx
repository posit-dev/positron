/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './newDataConnectionFlow.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { ConfigureDataConnection } from './configureDataConnection.js';
import { SelectDataConnectionProvider } from './selectDataConnectionProvider.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { IDataConnectionDriver } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';

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
	renderer: PositronModalDialogReactRenderer;
}

/**
 * NewDataConnectionFlow component.
 * Manages the forward/back transitions between the select provider and configure dialogs using a
 * single renderer so the background dimming does not flicker.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const NewDataConnectionFlow = (props: NewDataConnectionFlowProps) => {
	// Get the data connections service from the React services context.
	const { positronDataConnectionsService } = usePositronReactServicesContext();

	// State.
	const [step, setStep] = useState(NewDataConnectionFlowStep.SelectProvider);
	const [driver, setDriver] = useState<IDataConnectionDriver | undefined>(undefined);

	// Render the current step.
	switch (step) {
		// Step 1: Select provider.
		case NewDataConnectionFlowStep.SelectProvider:
			return (
				<SelectDataConnectionProvider
					renderer={props.renderer}
					onNext={selectedDriver => {
						// Remember the selected driver and transition to the configure step. The
						// profile itself is constructed by ConfigureDataConnection on save.
						setDriver(selectedDriver);
						setStep(NewDataConnectionFlowStep.Configure);
					}}
				/>
			);

		// Step 2: Configure connection.
		case NewDataConnectionFlowStep.Configure:
			return (
				<ConfigureDataConnection
					driver={driver!}
					renderer={props.renderer}
					onBack={() => setStep(NewDataConnectionFlowStep.SelectProvider)}
					onSave={profile => {
						// Add the connection profile in the service.
						positronDataConnectionsService.addUpdateProfile(profile);

						// Dispose the renderer to close the dialog.
						props.renderer.dispose();
					}}
				/>
			);
	}
};
