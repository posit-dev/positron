/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './GhostCellInfoModalDialog.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { OKModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKModalDialog.js';

// Localized strings.
const dialogTitle = localize('ghostCellInfo.title', 'About Ghost Cell Suggestions');
const gotItButtonLabel = localize('ghostCellInfo.gotIt', 'Got it');

const whatAreGhostCellsHeading = localize('ghostCellInfo.whatAreHeading', 'What are ghost cell suggestions?');
const whatAreGhostCellsText = localize('ghostCellInfo.whatAreText', 'Ghost cell suggestions are AI-generated code recommendations that appear after you execute a cell in your notebook. They help you continue your analysis by suggesting relevant next steps.');

const howDoTheyWorkHeading = localize('ghostCellInfo.howWorkHeading', 'How do they work?');
const howDoTheyWorkText = localize('ghostCellInfo.howWorkText', 'The AI analyzes your notebook context - including previous cells, outputs, and the overall structure - to suggest code that logically follows your current work.');

const howToDisableHeading = localize('ghostCellInfo.disableHeading', 'How to disable suggestions');
const howToDisableText = localize('ghostCellInfo.disableText', 'You can disable ghost cell suggestions by clicking "Don\'t suggest again" in the dismiss dropdown, or by toggling the setting in the Positron Assistant panel settings.');
const openAssistantPanelLabel = localize('ghostCellInfo.openAssistantPanel', 'Open notebook assistant settings');

/**
 * GhostCellInfoModalDialogProps interface.
 */
interface GhostCellInfoModalDialogProps {
	renderer: PositronModalReactRenderer;
}

/**
 * GhostCellInfoModalDialog component.
 * Displays information about ghost cell suggestions and how to manage them.
 */
export const GhostCellInfoModalDialog: React.FC<GhostCellInfoModalDialogProps> = ({ renderer }) => {
	const { commandService } = renderer.services;

	const handleClose = React.useCallback(() => {
		renderer.dispose();
	}, [renderer]);

	const handleOpenAssistantPanel = React.useCallback(() => {
		renderer.dispose(); // Close modal first
		commandService.executeCommand('positronNotebook.askAssistant');
	}, [renderer, commandService]);

	return (
		<OKModalDialog
			height={390}
			okButtonTitle={gotItButtonLabel}
			renderer={renderer}
			title={dialogTitle}
			width={480}
			onAccept={handleClose}
			onCancel={handleClose}
		>
			<div className='ghost-cell-info-content'>
				<div className='ghost-cell-info-section'>
					<div className='ghost-cell-info-heading'>{whatAreGhostCellsHeading}</div>
					<div className='ghost-cell-info-text'>{whatAreGhostCellsText}</div>
				</div>
				<div className='ghost-cell-info-section'>
					<div className='ghost-cell-info-heading'>{howDoTheyWorkHeading}</div>
					<div className='ghost-cell-info-text'>{howDoTheyWorkText}</div>
				</div>
				<div className='ghost-cell-info-section'>
					<div className='ghost-cell-info-heading'>{howToDisableHeading}</div>
					<div className='ghost-cell-info-text'>
						{howToDisableText}
						<button
							className='ghost-cell-info-settings-button'
							title={openAssistantPanelLabel}
							onClick={handleOpenAssistantPanel}
						>
							<span className='codicon codicon-positron-assistant' />
						</button>
					</div>
				</div>
			</div>
		</OKModalDialog>
	);
};
