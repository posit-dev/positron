/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./deleteAllVariablesModalDialog';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { ConfirmationModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/confirmationModalDialog';

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
			enterAccepts={true}
			title={(() => localize(
				'positron.deleteAllVariablesModalDialogTitle',
				"Delete All Variables"
			))()}
			secondaryActionTitle={(() => localize('positron.delete', "Delete"))()}
			secondaryActionDestructive={true}
			primaryActionTitle={(() => localize('positron.cancel', "Cancel"))()}
			onAccept={cancelHandler}
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
