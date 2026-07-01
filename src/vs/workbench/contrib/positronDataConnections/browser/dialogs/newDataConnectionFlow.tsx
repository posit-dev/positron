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
import { SelectDataConnectionMechanism } from './selectDataConnectionMechanism.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { IDataConnectionDriver, IDataConnectionMechanism } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';

/**
 * NewDataConnectionFlowStep enumeration.
 */
enum NewDataConnectionFlowStep {
	/**
	 * The user is selecting a data connection provider from the list of registered drivers.
	 */
	SelectProvider,

	/**
	 * The user is selecting which configuration mechanism to use for the selected provider. Skipped
	 * when the driver exposes only one mechanism.
	 */
	SelectMechanism,

	/**
	 * The user is configuring the connection settings for the selected provider and mechanism.
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
	const [mechanism, setMechanism] = useState<IDataConnectionMechanism | undefined>(undefined);

	// Render the current step.
	switch (step) {
		// Step 1: Select provider.
		case NewDataConnectionFlowStep.SelectProvider:
			return (
				<SelectDataConnectionProvider
					renderer={props.renderer}
					onNext={selectedDriver => {
						// Remember the selected driver. If it has a single mechanism, skip the
						// mechanism step and select it implicitly; otherwise go to the mechanism step.
						setDriver(selectedDriver);
						const mechanisms = selectedDriver.metadata.mechanisms;
						if (mechanisms.length === 1) {
							setMechanism(mechanisms[0]);
							setStep(NewDataConnectionFlowStep.Configure);
						} else {
							setStep(NewDataConnectionFlowStep.SelectMechanism);
						}
					}}
				/>
			);

		// Step 2: Select mechanism (only reached when the driver has multiple mechanisms).
		case NewDataConnectionFlowStep.SelectMechanism:
			return (
				<SelectDataConnectionMechanism
					driver={driver!}
					renderer={props.renderer}
					onBack={() => setStep(NewDataConnectionFlowStep.SelectProvider)}
					onNext={selectedMechanism => {
						// Remember the selected mechanism and transition to the configure step. The
						// profile itself is constructed by ConfigureDataConnection on save.
						setMechanism(selectedMechanism);
						setStep(NewDataConnectionFlowStep.Configure);
					}}
				/>
			);

		// Step 3: Configure connection.
		case NewDataConnectionFlowStep.Configure:
			return (
				<ConfigureDataConnection
					driver={driver!}
					mechanism={mechanism!}
					renderer={props.renderer}
					onBack={() => {
						// Return to the mechanism step, unless it was skipped (single mechanism), in
						// which case return to the provider step.
						setStep(driver!.metadata.mechanisms.length === 1
							? NewDataConnectionFlowStep.SelectProvider
							: NewDataConnectionFlowStep.SelectMechanism);
					}}
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
