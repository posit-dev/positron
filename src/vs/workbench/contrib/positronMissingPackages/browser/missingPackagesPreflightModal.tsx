/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './missingPackagesPreflightModal.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { PositronModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { Checkbox } from '../../../browser/positronComponents/positronModalDialog/components/checkbox.js';

/** The user's decision from the preflight modal. */
export type PreflightDecision = 'install-and-run' | 'run' | 'cancel';

export interface PreflightModalResult {
	readonly decision: PreflightDecision;
	readonly dontShowAgain: boolean;
}

interface MissingPackagesPreflightModalProps {
	readonly renderer: PositronModalReactRenderer;
	readonly fileName: string;
	readonly packageNames: string[];
	readonly onDecision: (result: PreflightModalResult) => void;
}

/**
 * Modal shown before a run gesture when the document references packages that
 * are not installed. Offers to install them and run, run anyway, or cancel.
 */
export const MissingPackagesPreflightModal = (props: MissingPackagesPreflightModalProps) => {
	const [dontShowAgain, setDontShowAgain] = useState(false);

	const decide = (decision: PreflightDecision) => {
		props.renderer.dispose();
		props.onDecision({ decision, dontShowAgain });
	};

	// Grow to fit the package list, within reason.
	const height = Math.min(440, 180 + props.packageNames.length * 22);

	return (
		<PositronModalDialog
			height={height}
			renderer={props.renderer}
			title={localize('positron.missingPackages.preflightTitle', "Install Missing Packages")}
			width={420}
			onCancel={() => decide('cancel')}
		>
			<div className='missing-packages-preflight'>
				<p className='preflight-message'>
					{localize('positron.missingPackages.preflightMessage', "{0} depends on the following packages, but they are not installed:", props.fileName)}
				</p>
				<ul className='preflight-package-list'>
					{props.packageNames.map(name => <li key={name}>{name}</li>)}
				</ul>
				<div className='preflight-dont-show-again'>
					<Checkbox
						label={localize('positron.missingPackages.preflightDontShowAgain', "Don't show this again")}
						onChanged={setDontShowAgain}
					/>
				</div>
				<div className='preflight-actions'>
					<Button className='button action-bar-button default' onPressed={() => decide('install-and-run')}>
						{localize('positron.missingPackages.preflightInstallAndRun', "Install Packages and Run")}
					</Button>
					<Button className='button action-bar-button' onPressed={() => decide('run')}>
						{localize('positron.missingPackages.preflightRunAnyway', "Run without Installing")}
					</Button>
					<Button className='button action-bar-button' onPressed={() => decide('cancel')}>
						{localize('positron.missingPackages.preflightCancel', "Cancel")}
					</Button>
				</div>
			</div>
		</PositronModalDialog>
	);
};

/**
 * Shows the preflight modal and resolves with the user's decision.
 */
export function showMissingPackagesPreflightModal(fileName: string, packageNames: string[]): Promise<PreflightModalResult> {
	return new Promise<PreflightModalResult>(resolve => {
		const renderer = new PositronModalReactRenderer();
		renderer.render(
			<MissingPackagesPreflightModal
				fileName={fileName}
				packageNames={packageNames}
				renderer={renderer}
				onDecision={resolve}
			/>
		);
	});
}
