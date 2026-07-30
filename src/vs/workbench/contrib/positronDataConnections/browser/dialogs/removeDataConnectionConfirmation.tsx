/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { DestructiveTwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/destructiveTwoButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';

// The width of the Remove Connection confirmation dialog.
const REMOVE_CONNECTION_CONFIRMATION_WIDTH = 460;

/**
 * Shows the Remove Connection confirmation dialog. Removing a connection deletes its saved settings
 * and stored secrets, and takes down anything still using it, so the dialog spells out what goes
 * with it before the user commits.
 * @param connectionName The name of the connection to be removed.
 * @param openDataExplorerCount How many Data Explorers previewed from the connection are open, and
 * so will close along with it. Zero when none are.
 * @returns A promise that resolves to true if the user confirmed, or false if they cancelled.
 */
export const showRemoveDataConnectionConfirmation = (
	connectionName: string,
	openDataExplorerCount: number
): Promise<boolean> => {
	// Create the renderer.
	const renderer = new PositronModalDialogReactRenderer();

	return new Promise<boolean>(resolve => {
		// Settle once: dispose the renderer and resolve with the user's choice. Guards against the
		// dialog's onCancel firing again after an explicit Remove or Cancel.
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
			<RemoveDataConnectionConfirmation
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
 * RemoveDataConnectionConfirmationProps interface.
 */
interface RemoveDataConnectionConfirmationProps {
	readonly connectionName: string;
	readonly openDataExplorerCount: number;
	readonly renderer: PositronModalDialogReactRenderer;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
}

/**
 * RemoveDataConnectionConfirmation component.
 * @param props The component props.
 */
const RemoveDataConnectionConfirmation = (props: RemoveDataConnectionConfirmationProps) => {
	// The consequence of removing the connection. Named separately per count, since localized strings
	// cannot select a plural form from a placeholder.
	let dataExplorersDetail;
	if (props.openDataExplorerCount === 1) {
		dataExplorersDetail = localize(
			'positron.removeDataConnectionConfirmation.oneDataExplorer',
			"The Data Explorer open on this connection will close."
		);
	} else if (props.openDataExplorerCount > 1) {
		dataExplorersDetail = localize(
			'positron.removeDataConnectionConfirmation.manyDataExplorers',
			"The {0} Data Explorers open on this connection will close.",
			props.openDataExplorerCount
		);
	}

	return (
		<PositronDynamicModalDialog
			content={
				<div>
					<div>
						{localize(
							'positron.removeDataConnectionConfirmation.detail',
							"The saved settings and stored secrets for '{0}' will be deleted. This cannot be undone.",
							props.connectionName
						)}
					</div>
					{dataExplorersDetail && <div>{dataExplorersDetail}</div>}
				</div>
			}
			footer={
				<DestructiveTwoButtonFooter
					primaryButtonTitle={localize('positron.removeDataConnectionConfirmation.confirm', "Remove")}
					secondaryButtonTitle={localize('positron.removeDataConnectionConfirmation.cancel', "Cancel")}
					onPrimaryButton={props.onConfirm}
					onSecondaryButton={props.onCancel}
				/>
			}
			renderer={props.renderer}
			title={localize('positron.removeDataConnectionConfirmation.title', "Remove Connection?")}
			titleSize='large'
			width={REMOVE_CONNECTION_CONFIRMATION_WIDTH}
			onCancel={props.onCancel}
		/>
	);
};
