/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useCallback } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';

/**
 * AssistantPanelSettingsProps interface.
 */
export interface AssistantPanelSettingsProps {
	preferencesService: IPreferencesService;
	onOpenSettings: () => void;
}

/**
 * AssistantPanelSettings component.
 * Provides a button to open notebook AI settings in VS Code settings UI.
 */
export const AssistantPanelSettings = (props: AssistantPanelSettingsProps) => {
	const { preferencesService, onOpenSettings } = props;

	const handleOpenSettings = useCallback(async () => {
		// Close the panel first
		onOpenSettings();

		// Open settings filtered to notebook AI settings
		await preferencesService.openSettings({ query: 'positron.assistant.notebook' });
	}, [preferencesService, onOpenSettings]);

	return (
		<div className='assistant-panel-section'>
			<div className='assistant-panel-section-header'>
				<span>{localize('assistantPanel.settings.header', 'Settings')}</span>
				<button
					aria-label={localize('assistantPanel.settings.openLabel', 'Open Notebook AI Settings')}
					className='assistant-panel-settings-button codicon codicon-settings-gear'
					title={localize('assistantPanel.settings.openTooltip', 'Open Notebook AI Settings')}
					onClick={handleOpenSettings}
				/>
			</div>
			<div className='assistant-panel-section-content'>
				<button
					className='assistant-panel-settings-link'
					onClick={handleOpenSettings}
				>
					<span className='codicon codicon-link-external' />
					<span>{localize('assistantPanel.settings.openButton', 'Open Notebook AI Settings')}</span>
				</button>
			</div>
		</div>
	);
};
