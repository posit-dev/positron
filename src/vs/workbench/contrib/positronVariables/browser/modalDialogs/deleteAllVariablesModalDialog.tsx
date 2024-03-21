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
import { PositronModalReactParams } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { OKCancelModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronOKCancelModalDialog';

/**
 * Localized strings.
 */
const title = localize('positron.deleteAllVariablesModalDialogTitle', "Delete All Variables");
const yes = localize('positron.yes', "Yes");
const no = localize('positron.no', "No");
const text = localize('positron.deleteAllVariablesModalDialogText', "Are you sure you want to delete all variables? This operation cannot be undone.");

/**
 * DeleteAllVariablesResult interface.
 */
export interface DeleteAllVariablesResult {
	includeHiddenObjects: boolean;
}

/**
 * DeleteAllVariablesModalDialog component.
 * @param props The component properties.
 * @returns The component.
 */
export const DeleteAllVariablesModalDialog = (
	props: PositronModalReactParams<DeleteAllVariablesResult>
) => {
	// Render.
	return (
		<OKCancelModalDialog
			renderer={props.renderer}
			width={375}
			height={175}
			title={title}
			okButtonTitle={yes}
			cancelButtonTitle={no}
			onAccept={() => {
				props.accepted({
					includeHiddenObjects: false
				});
				props.renderer.dispose();
			}}
			onCancel={() => props.renderer.dispose()}>

			<VerticalStack>
				<div>{text}</div>
				{/* Disabled for Private Alpha. */}
				{/* <Checkbox label='Include hidden objects' onChanged={checked => setResult({ ...result, includeHiddenObjects: checked })} /> */}
			</VerticalStack>

		</OKCancelModalDialog>
	);
};
