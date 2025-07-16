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
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { IPositronModalReactRenderer, PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';

const NEW_CONNECTION_MODAL_DIALOG_WIDTH = 700;
const NEW_CONNECTION_MODAL_DIALOG_HEIGHT = 630;

export const showNewConnectionModalDialog = (instantiationService: IInstantiationService) => {

	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	renderer.render(
		<NewConnectionModalDialog renderer={renderer} />
	);
};

interface NewConnectionModalDialogProps {
	readonly renderer: IPositronModalReactRenderer;
}

const NewConnectionModalDialog = (props: PropsWithChildren<NewConnectionModalDialogProps>) => {
	const [selectedDriver, setSelectedDriver] = useState<IDriver | undefined>();
	const [languageId, setLanguageId] = useState<string | undefined>(getPreferedLanguageId(props.renderer.services));

	const cancelHandler = () => {
		props.renderer.dispose();
	};

	const backHandler = () => {
		// When hitting back, reset the language ID to the previously selected language id
		setLanguageId(selectedDriver?.metadata.languageId);
		setSelectedDriver(undefined);
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
				{
					selectedDriver ?
						<CreateConnection
							renderer={props.renderer}
							selectedDriver={selectedDriver}
							onBack={backHandler}
							onCancel={cancelHandler} /> :
						<ListDrivers
							languageId={languageId}
							setLanguageId={setLanguageId}
							onCancel={cancelHandler}
							onSelection={(driver) => setSelectedDriver(driver)}
						/>}
			</ContentArea>
		</div>
	</PositronModalDialog>;
};

const getPreferedLanguageId = (services: PositronReactServices): string | undefined => {
	// If threre is a foreground session, use its language ID as the preferred language id
	return services.runtimeSessionService.foregroundSession?.runtimeMetadata.languageId;
};
