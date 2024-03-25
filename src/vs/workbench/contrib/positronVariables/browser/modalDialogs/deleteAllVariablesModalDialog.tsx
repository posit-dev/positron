/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./deleteAllVariablesModalDialog';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { OKCancelModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronOKCancelModalDialog';

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
	// Render.
	return (
		<OKCancelModalDialog
			renderer={props.renderer}
			width={375}
			height={175}
			title={localize('positron.deleteAllVariablesModalDialogTitle', "Delete All Variables")}
			okButtonTitle={localize('positron.yes', "Yes")}
			cancelButtonTitle={localize('positron.no', "No")}
			onAccept={async () => {
				props.renderer.dispose();
				await props.deleteAllVariablesAction({
					includeHiddenObjects: false
				});
			}}
			onCancel={() => props.renderer.dispose()}
		>
			<VerticalStack>
				<div>
					{localize(
						'positron.deleteAllVariablesModalDialogText',
						"Are you sure you want to delete all variables? This operation cannot be undone."
					)}
				</div>
				{/* Disabled for Private Alpha. */}
				{/* <Checkbox label='Include hidden objects' onChanged={checked => setResult({ ...result, includeHiddenObjects: checked })} /> */}
			</VerticalStack>
		</OKCancelModalDialog>
	);
};
