/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';

// The width of the Include Secrets confirmation dialog.
const INCLUDE_SECRETS_CONFIRMATION_WIDTH = 460;

/**
 * Shows the Include Secrets confirmation dialog, warning the user that embedding secret values in
 * the generated connection code can expose them.
 * @returns A promise that resolves to true if the user confirmed, or false if they cancelled.
 */
export const showIncludeSecretsConfirmation = (): Promise<boolean> => {
	// Create the renderer.
	const renderer = new PositronModalDialogReactRenderer();

	return new Promise<boolean>(resolve => {
		// Settle once: dispose the renderer and resolve with the user's choice. Guards against the
		// dialog's onCancel firing again after an explicit OK or Cancel.
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
			<IncludeSecretsConfirmation
				renderer={renderer}
				onCancel={() => settle(false)}
				onConfirm={() => settle(true)}
			/>
		);
	});
};

/**
 * IncludeSecretsConfirmationProps interface.
 */
interface IncludeSecretsConfirmationProps {
	readonly renderer: PositronModalDialogReactRenderer;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
}

/**
 * IncludeSecretsConfirmation component.
 * @param props The component props.
 */
const IncludeSecretsConfirmation = (props: IncludeSecretsConfirmationProps) => {
	return (
		<PositronDynamicModalDialog
			content={
				<div>
					{localize(
						'positron.includeSecretsConfirmation.detail',
						"Passwords and other secrets will be written into the connection code. They may be exposed in console history, the clipboard, or any script you create from this code."
					)}
				</div>
			}
			footer={
				<TwoButtonFooter
					primaryButtonTitle={localize('positron.includeSecretsConfirmation.confirm', "Include Secrets")}
					secondaryButtonTitle={localize('positron.includeSecretsConfirmation.cancel', "Cancel")}
					onPrimaryButton={props.onConfirm}
					onSecondaryButton={props.onCancel}
				/>
			}
			renderer={props.renderer}
			title={localize('positron.includeSecretsConfirmation.title', "Include Secrets?")}
			titleBarSize='large'
			width={INCLUDE_SECRETS_CONFIRMATION_WIDTH}
			onCancel={props.onCancel}
		/>
	);
};
