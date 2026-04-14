/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionActionBar.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { PlatformNativeDialogActionBar } from '../../../../browser/positronComponents/positronModalDialog/components/platformNativeDialogActionBar.js';

/**
 * DataConnectionActionBarProps interface.
 */
interface DataConnectionActionBarProps {
	// The label for the primary (accept) button.
	acceptLabel: string;

	// Whether the accept button is disabled.
	acceptDisabled?: boolean;

	// Called when the user clicks the accept button.
	onAccept: () => void;

	// Called when the user clicks the cancel button.
	onCancel: () => void;

	// Called when the user clicks the back button. If undefined, the back button is not shown.
	onBack?: () => void;
}

/**
 * DataConnectionActionBar component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const DataConnectionActionBar = (props: DataConnectionActionBarProps) => {
	return (
		<div className='data-connection-action-bar'>
			<div className='left-actions'>
				{props.onBack && (
					<Button className='action-bar-button' onPressed={props.onBack}>
						{localize('positron.dataConnectionActionBar.back', "Back")}
					</Button>
				)}
			</div>
			<div className='right-actions'>
				<PlatformNativeDialogActionBar
					primaryButton={
						<Button className='action-bar-button default' disabled={props.acceptDisabled} onPressed={props.onAccept}>
							{props.acceptLabel}
						</Button>
					}
					secondaryButton={
						<Button className='action-bar-button' onPressed={props.onCancel}>
							{localize('positron.dataConnectionActionBar.cancel', "Cancel")}
						</Button>
					}
				/>
			</div>
		</div>
	);
};
