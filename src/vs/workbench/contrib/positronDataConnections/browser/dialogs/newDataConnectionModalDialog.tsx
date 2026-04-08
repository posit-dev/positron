/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './newDataConnectionModalDialog.css';

// Other dependencies.
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
	const acceptHandler = () => {
		console.log('Accept');
		props.renderer.dispose();
	};

	const cancelHandler = () => {
		console.log('Cancel');
		props.renderer.dispose();
	};

	// Render.
	return (
		<PositronModalDialog height={400} renderer={props.renderer} title='Yes' width={400} onCancel={cancelHandler} >
			<ContentArea>
				<div>Hello</div>
			</ContentArea>
			<OKCancelActionBar
				cancelButtonTitle='Cancel'
				okButtonTitle='Next'
				onAccept={acceptHandler}
				onCancel={cancelHandler}
			/>
		</PositronModalDialog>
	);
};
