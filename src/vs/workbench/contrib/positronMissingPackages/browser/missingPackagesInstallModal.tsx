/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './missingPackagesInstallModal.css';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { PositronModalDialogReactRenderer } from '../../../../base/browser/positronModalDialogReactRenderer.js';
import { PositronDynamicModalDialog } from '../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { FooterButton } from '../../../browser/positronComponents/positronDynamicModalDialog/components/footerButton.js';
import { MissingPackagesMessage } from './missingPackagesMessage.js';

interface MissingPackagesInstallModalProps {
	readonly renderer: PositronModalDialogReactRenderer;
	readonly fileName: string;
	readonly languageName: string | null;
	readonly packageNames: string[];
	readonly installLabel: string;
	readonly onDecision: (confirmed: boolean) => void;
}

/**
 * Modal shown by the "Check for Missing Packages" command when a document
 * references packages that are not installed. Offers to install them or cancel.
 * Shares its body with the preflight modal via {@link MissingPackagesMessage}.
 */
const MissingPackagesInstallModal = (props: MissingPackagesInstallModalProps) => {
	const decide = (confirmed: boolean) => {
		props.renderer.dispose();
		props.onDecision(confirmed);
	};

	return (
		<PositronDynamicModalDialog
			content={
				<MissingPackagesMessage
					fileName={props.fileName}
					languageName={props.languageName}
					packageNames={props.packageNames}
				/>
			}
			footer={
				<div className='missing-packages-install-footer'>
					<FooterButton onPressed={() => decide(false)}>
						{localize('positron.missingPackages.installModalCancel', "Cancel")}
					</FooterButton>
					<FooterButton default type='submit' onPressed={() => decide(true)}>
						{props.installLabel}
					</FooterButton>
				</div>
			}
			renderer={props.renderer}
			title={localize('positron.missingPackages.installModalTitle', "Install Missing Packages")}
			width={480}
			onCancel={() => decide(false)}
			onSubmit={() => decide(true)}
		/>
	);
};

/**
 * Shows the install modal and resolves with whether the user chose to install.
 */
export function showMissingPackagesInstallModal(fileName: string, languageName: string | null, packageNames: string[], installLabel: string): Promise<boolean> {
	return new Promise<boolean>(resolve => {
		const renderer = new PositronModalDialogReactRenderer();
		renderer.render(
			<MissingPackagesInstallModal
				fileName={fileName}
				installLabel={installLabel}
				languageName={languageName}
				packageNames={packageNames}
				renderer={renderer}
				onDecision={resolve}
			/>
		);
	});
}
