/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./deleteAllVariablesModalDialog';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { VerticalStack } from '../../../../browser/positronComponents/positronModalDialog/components/verticalStack.js';
import { PositronModalReactRenderer } from '../../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { ConfirmationModalDialog } from '../../../../browser/positronComponents/positronModalDialog/confirmationModalDialog.js';

/**
 * DeleteAllVariablesResult interface.
 */
export interface DeleteAllVariablesResult {
	includeHiddenObjects: boolean;
}

/**
 * DeleteAllVariablesModalDialogProps interface.
 */
interface DeleteAllVariablesModalDialogProps {
	renderer: PositronModalReactRenderer;
	deleteAllVariablesAction: (result: DeleteAllVariablesResult) => Promise<void>;
}

/**
 * DeleteAllVariablesModalDialog component.
 * @param props The component properties.
 * @returns The component.
 */
export const DeleteAllVariablesModalDialog = (props: DeleteAllVariablesModalDialogProps) => {
	/**
	 * Accept handler.
	 */
	const acceptHandler = async (): Promise<void> => {
		props.renderer.dispose();
		await props.deleteAllVariablesAction({
			includeHiddenObjects: false
		});
	};

	/**
	 * Cancel handler.
	 */
	const cancelHandler = () => {
		props.renderer.dispose();
	};

	return (
		<ConfirmationModalDialog
			renderer={props.renderer}
			width={375}
			height={175}
			title={(() => localize(
				'positron.deleteAllVariablesModalDialogTitle',
				"Delete All Variables"
			))()}
			secondaryActionTitle={(() => localize('positron.delete', "Delete"))()}
			secondaryActionDestructive={true}
			primaryActionTitle={(() => localize('positron.cancel', "Cancel"))()}
			onCancel={cancelHandler}
			onSecondaryAction={acceptHandler}
			onPrimaryAction={cancelHandler}
		>
			<VerticalStack>
				<div>
					{(() => localize(
						'positron.deleteAllVariablesModalDialogText',
						"Are you sure you want to delete all variables? This operation cannot be undone."
					))()}
				</div>
				{/* Disabled for Private Alpha. */}
				{/* <Checkbox label='Include hidden objects' onChanged={checked => setResult({ ...result, includeHiddenObjects: checked })} /> */}
			</VerticalStack>
		</ConfirmationModalDialog>
	);
};
