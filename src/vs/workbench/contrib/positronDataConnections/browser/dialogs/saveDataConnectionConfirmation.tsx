/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './saveDataConnectionConfirmation.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';

// The width of the Save Changes confirmation dialog.
const SAVE_CONNECTION_CONFIRMATION_WIDTH = 460;

/**
 * Shows the Save Changes confirmation dialog. A connection is opened from the values a profile had
 * at the time, so editing any of them closes it -- and the Data Explorers previewed from it, whose
 * backends die with it. Nothing is lost that cannot be reopened, but the user is not expecting a
 * save to take their grids down, so the dialog says so first.
 * @param connectionName The name of the connection being edited.
 * @param openDataExplorerCount How many Data Explorers previewed from the connection are open, and
 * so will close along with it. Always at least one; a save with none open does not need confirming.
 * @returns A promise that resolves to true if the user confirmed, or false if they cancelled.
 */
export const showSaveDataConnectionConfirmation = (
	connectionName: string,
	openDataExplorerCount: number
): Promise<boolean> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	return new Promise<boolean>(resolve => {
		// Settle once: dispose the renderer and resolve with the user's choice. Guards against the
		// dialog's onCancel firing again after an explicit Save or Cancel.
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
			<SaveDataConnectionConfirmation
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
 * SaveDataConnectionConfirmationProps interface.
 */
interface SaveDataConnectionConfirmationProps {
	readonly connectionName: string;
	readonly openDataExplorerCount: number;
	readonly renderer: PositronModalReactRenderer;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
}

/**
 * SaveDataConnectionConfirmation component.
 * @param props The component props.
 */
const SaveDataConnectionConfirmation = (props: SaveDataConnectionConfirmationProps) => {
	// The consequence of saving. Named separately per count, since localized strings cannot select a
	// plural form from a placeholder.
	const dataExplorersDetail = props.openDataExplorerCount === 1
		? localize(
			'positron.saveDataConnectionConfirmation.oneDataExplorer',
			"The Data Explorer open on this connection will close."
		)
		: localize(
			'positron.saveDataConnectionConfirmation.manyDataExplorers',
			"The {0} Data Explorers open on this connection will close.",
			props.openDataExplorerCount
		);

	return (
		<PositronDynamicModalDialog
			content={
				<div className='save-data-connection-confirmation'>
					<div>
						{localize(
							'positron.saveDataConnectionConfirmation.detail',
							"These changes close the connection to '{0}' so it can reopen with the new settings.",
							props.connectionName
						)}
					</div>
					<div>{dataExplorersDetail}</div>
				</div>
			}
			footer={
				<TwoButtonFooter
					primaryButtonTitle={localize('positron.saveDataConnectionConfirmation.confirm', "Save")}
					secondaryButtonTitle={localize('positron.saveDataConnectionConfirmation.cancel', "Cancel")}
					onPrimaryButton={props.onConfirm}
					onSecondaryButton={props.onCancel}
				/>
			}
			renderer={props.renderer}
			title={localize('positron.saveDataConnectionConfirmation.title', "Save Changes?")}
			width={SAVE_CONNECTION_CONFIRMATION_WIDTH}
			onCancel={props.onCancel}
		/>
	);
};
