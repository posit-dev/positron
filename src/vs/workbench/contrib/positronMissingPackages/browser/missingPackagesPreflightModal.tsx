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
					<div className='preflight-message'>
						{/* The filename is a non-localizable identifier rendered as a
						    monospace element, followed by a complete localized clause. */}
						<code className='preflight-filename'>{props.fileName}</code>
						{' '}
						{props.languageName
							? localize('positron.missingPackages.preflightMessageLang', "depends on the following {0} packages, but they are not installed:", props.languageName)
							: localize('positron.missingPackages.preflightMessage', "depends on the following packages, but they are not installed:")}
					</div>
					<ul className='preflight-package-list'>
						{props.packageNames.map(name => <li key={name}>{name}</li>)}
					</ul>
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
