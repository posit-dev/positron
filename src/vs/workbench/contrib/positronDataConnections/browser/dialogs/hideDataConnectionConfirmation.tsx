/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './hideDataConnectionConfirmation.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';

// The width of the Hide Connection confirmation dialog.
const HIDE_CONNECTION_CONFIRMATION_WIDTH = 460;

/**
 * Shows the Hide Connection confirmation dialog. Hiding a detected connection closes it, and the
 * Data Explorers previewed from it close with it. Show Hidden Connections brings the row back but
 * not the grids, so the dialog says so first.
 * @param connectionName The name of the connection being hidden.
 * @param openDataExplorerCount How many Data Explorers previewed from the connection are open, and
 * so will close along with it. Always at least one; a hide with none open does not need confirming.
 * @returns A promise that resolves to true if the user confirmed, or false if they cancelled.
 */
export const showHideDataConnectionConfirmation = (
	connectionName: string,
	openDataExplorerCount: number
): Promise<boolean> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	return new Promise<boolean>(resolve => {
		// Settle once: dispose the renderer and resolve with the user's choice. Guards against the
		// dialog's onCancel firing again after an explicit Hide or Cancel.
		let settled = false;
		const settle = (confirmed: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			renderer.dispose();
			resolve(confirmed);
		};

		// Render the dialog.
		renderer.render(
			<HideDataConnectionConfirmation
				connectionName={connectionName}
				openDataExplorerCount={openDataExplorerCount}
				renderer={renderer}
				onCancel={() => settle(false)}
				onConfirm={() => settle(true)}
			/>
		);
	});
};

/**
 * HideDataConnectionConfirmationProps interface.
 */
interface HideDataConnectionConfirmationProps {
	readonly connectionName: string;
	readonly openDataExplorerCount: number;
	readonly renderer: PositronModalReactRenderer;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
}

/**
 * HideDataConnectionConfirmation component.
 * @param props The component props.
 */
const HideDataConnectionConfirmation = (props: HideDataConnectionConfirmationProps) => {
	// The consequence of hiding. Named separately per count, since localized strings cannot select a
	// plural form from a placeholder.
	const dataExplorersDetail = props.openDataExplorerCount === 1
		? localize(
			'positron.hideDataConnectionConfirmation.oneDataExplorer',
			"The Data Explorer open on this connection will close."
		)
		: localize(
			'positron.hideDataConnectionConfirmation.manyDataExplorers',
			"The {0} Data Explorers open on this connection will close.",
			props.openDataExplorerCount
		);

	return (
		<PositronDynamicModalDialog
			content={
				<div className='hide-data-connection-confirmation'>
					<div>
						{localize(
							'positron.hideDataConnectionConfirmation.detail',
							"Hiding '{0}' closes its connection. You can show it again with Show Hidden Connections.",
							props.connectionName
						)}
					</div>
					<div>{dataExplorersDetail}</div>
				</div>
			}
			footer={
				<TwoButtonFooter
					primaryButtonTitle={localize('positron.hideDataConnectionConfirmation.confirm', "Hide")}
					secondaryButtonTitle={localize('positron.hideDataConnectionConfirmation.cancel', "Cancel")}
					onPrimaryButton={props.onConfirm}
					onSecondaryButton={props.onCancel}
				/>
			}
			renderer={props.renderer}
			title={localize('positron.hideDataConnectionConfirmation.title', "Hide Connection?")}
			width={HIDE_CONNECTION_CONFIRMATION_WIDTH}
			onCancel={props.onCancel}
		/>
	);
};
