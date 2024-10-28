/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { PropsWithChildren } from 'react';
import { localize } from 'vs/nls';
import { PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { PositronConnectionsServices } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';

const RESUME_CONNECTION_MODAL_DIALOG_WIDTH = 500;
const RESUME_CONNECTION_MODAL_DIALOG_HEIGHT = 600;

export const showResumeConnectionModalDialog = (
	services: PositronConnectionsServices,
) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService: services.keybindingService,
		layoutService: services.layoutService,
		container: services.layoutService.activeContainer
	});

	renderer.render(
		<ResumeConnectionModalDialog
			renderer={renderer}
		/>
	);
};

interface ResumeConnectionModalDialogProps {
	readonly renderer: PositronModalReactRenderer;
}

const ResumeConnectionModalDialog = (props: PropsWithChildren<ResumeConnectionModalDialogProps>) => {
	return (
		<PositronModalDialog
			width={RESUME_CONNECTION_MODAL_DIALOG_WIDTH}
			height={RESUME_CONNECTION_MODAL_DIALOG_HEIGHT}
			title={(() => localize('positron.resumeConnectionModalDialog.title', "Resume Connection"))()}
			onCancel={() => props.renderer.dispose()}
			renderer={props.renderer}
		>
		</PositronModalDialog>
	);
};
