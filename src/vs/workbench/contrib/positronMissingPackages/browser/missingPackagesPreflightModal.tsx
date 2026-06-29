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
import { PositronModalDialogReactRenderer } from '../../../../base/browser/positronModalDialogReactRenderer.js';
import { PositronDynamicModalDialog } from '../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { FooterButton } from '../../../browser/positronComponents/positronDynamicModalDialog/components/footerButton.js';
import { Checkbox } from '../../../browser/positronComponents/positronModalDialog/components/checkbox.js';
import { MissingPackagesMessage } from './missingPackagesMessage.js';

/** The user's decision from the preflight modal. */
export type PreflightDecision = 'install-and-run' | 'run' | 'cancel';

export interface PreflightModalResult {
	readonly decision: PreflightDecision;
	readonly dontShowAgain: boolean;
}

interface MissingPackagesPreflightModalProps {
	readonly renderer: PositronModalDialogReactRenderer;
	readonly fileName: string;
	readonly languageName: string | null;
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

	return (
		<PositronDynamicModalDialog
			content={
				<div className='missing-packages-preflight'>
					<MissingPackagesMessage
						fileName={props.fileName}
						languageName={props.languageName}
						packageNames={props.packageNames}
					/>
					<div className='preflight-dont-show-again'>
						<Checkbox
							label={localize('positron.missingPackages.preflightDontShowAgain', "Don't show this again")}
							onChanged={setDontShowAgain}
						/>
					</div>
				</div>
			}
			footer={
				<div className='preflight-footer'>
					<FooterButton onPressed={() => decide('cancel')}>
						{localize('positron.missingPackages.preflightCancel', "Cancel")}
					</FooterButton>
					<div className='preflight-footer-right'>
						<FooterButton default type='submit' onPressed={() => decide('install-and-run')}>
							{localize('positron.missingPackages.preflightInstallAndRun', "Install Packages and Run")}
						</FooterButton>
						<FooterButton onPressed={() => decide('run')}>
							{localize('positron.missingPackages.preflightRunAnyway', "Run Without Installing")}
						</FooterButton>
					</div>
				</div>
			}
			renderer={props.renderer}
			title={localize('positron.missingPackages.preflightTitle', "Install Missing Packages")}
			width={480}
			onCancel={() => decide('cancel')}
			onSubmit={() => decide('install-and-run')}
		/>
	);
};

/**
 * Shows the preflight modal and resolves with the user's decision.
 */
export function showMissingPackagesPreflightModal(fileName: string, languageName: string | null, packageNames: string[]): Promise<PreflightModalResult> {
	return new Promise<PreflightModalResult>(resolve => {
		const renderer = new PositronModalDialogReactRenderer();
		renderer.render(
			<MissingPackagesPreflightModal
				fileName={fileName}
				languageName={languageName}
				packageNames={packageNames}
				renderer={renderer}
				onDecision={resolve}
			/>
		);
	});
}
