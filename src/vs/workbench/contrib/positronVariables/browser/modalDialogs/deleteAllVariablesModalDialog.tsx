/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './deleteAllVariablesModalDialog.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { VerticalStack } from '../../../../browser/positronComponents/positronModalDialog/components/verticalStack.js';
import { PositronModalReactRenderer } from '../../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { ConfirmDeleteModalDialog } from '../../../../browser/positronComponents/positronModalDialog/confirmDeleteModalDialog.js';

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
		<ConfirmDeleteModalDialog
			height={175}
			renderer={props.renderer}
			title={(() => localize(
				'positron.deleteAllVariablesModalDialogTitle',
				"Delete All Variables"
			))()}
			width={375}
			onCancel={cancelHandler}
			onDeleteAction={acceptHandler}
		>
			<VerticalStack>
				<div>
					{(() => localize(
						'positron.deleteAllVariablesModalDialogText',
						"Are you sure you want to delete all variables? This operation cannot be undone."
					))()}
				</div>
			</VerticalStack>
		</ConfirmDeleteModalDialog>
	);
};
