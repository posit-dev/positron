/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


// CSS.
import './newConnectionModelDialog.css';

// React.
import React, { PropsWithChildren, useState } from 'react';

// Other dependendencies.
import { localize } from '../../../../../nls.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { CreateConnection } from './newConnectionModalDialog/createConnectionState.js';
import { ListDrivers } from './newConnectionModalDialog/listDriversState.js';
import { IDriver } from '../../../../services/positronConnections/common/interfaces/positronConnectionsDriver.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { ListDriversDetails } from './newConnectionModalDialog/listDriversDetailsState.js';

const NEW_CONNECTION_MODAL_DIALOG_WIDTH = 700;
const NEW_CONNECTION_MODAL_DIALOG_HEIGHT = 630;

export const showNewConnectionModalDialog = () => {

	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	renderer.render(
		<NewConnectionModalDialog renderer={renderer} />
	);
};

interface NewConnectionModalDialogProps {
	readonly renderer: PositronModalReactRenderer;
}


const NewConnectionModalDialog = (props: PropsWithChildren<NewConnectionModalDialogProps>) => {

	enum ModalStateKind {
		ListDrivers,
		CreateConnection,
		SelectDriverDetails
	}

	type ModalState = { kind: ModalStateKind.ListDrivers } |
	{ kind: ModalStateKind.CreateConnection, driver: IDriver, previous: ModalState } |
	{ kind: ModalStateKind.SelectDriverDetails, drivers: IDriver[], previous: ModalState };

	const [modalState, setModalState] = useState<ModalState>({ kind: ModalStateKind.ListDrivers });

	// If there is a foreground session, use its language ID as the preferred language id.
	const [languageId, setLanguageId] = useState<string | undefined>(
		props.renderer.services.runtimeSessionService.foregroundSession?.runtimeMetadata.languageId
	);

	const cancelHandler = () => {
		props.renderer.dispose();
	};

	const backHandler = () => {
		// When hitting back, reset the language ID to the previously selected language id
		switch (modalState.kind) {
			case ModalStateKind.CreateConnection:
				setLanguageId(modalState.driver.metadata.languageId);
				setModalState(modalState.previous);
				break;
			case ModalStateKind.SelectDriverDetails:
				setLanguageId(modalState.drivers[0].metadata.languageId);
				setModalState(modalState.previous);
				break;
			case ModalStateKind.ListDrivers:
				// no-op
				break;
		}
	};

	return <PositronModalDialog
		height={NEW_CONNECTION_MODAL_DIALOG_HEIGHT}
		renderer={props.renderer}
		title={(() => localize('positron.newConnectionModalDialog.title', "Create New Connection"))()}
		width={NEW_CONNECTION_MODAL_DIALOG_WIDTH}
		onCancel={cancelHandler}
	>
		<div className='connections-new-connection-modal'>
			<ContentArea>
				{(() => {
					switch (modalState.kind) {
						case ModalStateKind.CreateConnection:
							return <CreateConnection
								renderer={props.renderer}
								selectedDriver={modalState.driver}
								onBack={backHandler}
								onCancel={cancelHandler} />;
						case ModalStateKind.ListDrivers:
							return <ListDrivers
								languageId={languageId}
								setLanguageId={setLanguageId}
								onCancel={cancelHandler}
								onSelection={(drivers) => {
									if (drivers.length === 1) {
										// if there's a single driver with that name, we don't need to filter out
										// anything
										setModalState({ kind: ModalStateKind.CreateConnection, driver: drivers[0], previous: modalState });
									} else {
										// otherwise we set the state the user to the user select the driver details
										setModalState({ kind: ModalStateKind.SelectDriverDetails, drivers, previous: modalState });
									}
								}} />;
						case ModalStateKind.SelectDriverDetails:
							return <ListDriversDetails
								drivers={modalState.drivers}
								onBack={backHandler}
								onCancel={cancelHandler}
								onDriverSelected={(driver) => {
									setModalState({ kind: ModalStateKind.CreateConnection, driver, previous: modalState });
								}} />;
					}
				})()}
			</ContentArea>
		</div>
	</PositronModalDialog>;
};
