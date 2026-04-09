/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './newDataConnectionModalDialog.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { OKCancelActionBar } from '../../../../browser/positronComponents/positronModalDialog/components/okCancelActionBar.js';

/**
 * NewDataConnectionModalDialogProps interface.
 */
interface NewDataConnectionModalDialogProps {
	renderer: PositronModalReactRenderer;
}

/**
 * NewDataConnectionModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const NewDataConnectionModalDialog = (props: NewDataConnectionModalDialogProps) => {
	/**
	 * Cancel handler.
	 */
	const cancelHandler = () => {
		props.renderer.dispose();
	};

	/**
	 * Accept handler.
	 */
	const acceptHandler = () => {
		props.renderer.dispose();
	};

	// Render.
	return (
		<PositronModalDialog
			height={400}
			renderer={props.renderer}
			title={localize(
				'positron.newDataConnectionModalDialog.title',
				"New Data Connection"
			)}
			width={600}
			onCancel={cancelHandler}
		>
			<ContentArea>
				<div>Select a provider</div>
				<div>YAYA</div>
			</ContentArea>
			<OKCancelActionBar
				okButtonTitle={localize('positron.newDataConnectionModalDialog.next', "Next")}
				onAccept={acceptHandler}
				onCancel={cancelHandler}
			/>
		</PositronModalDialog>
	);
};
