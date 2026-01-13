/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './AssistantPanel.css';

// React.
import React, { useCallback, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';
import { AssistantPanelContext } from './AssistantPanelContext.js';
import { AssistantPanelActions } from './AssistantPanelActions.js';
import { INotebookContextDTO } from '../../../../api/common/positron/extHost.positron.protocol.js';
import { ChatModeKind } from '../../../chat/common/constants.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';

/**
 * AssistantPanelProps interface.
 * Services are passed directly as props (explicit dependency pattern).
 */
export interface AssistantPanelProps {
	notebook: IPositronNotebookInstance;
	renderer: PositronModalReactRenderer;
	commandService: ICommandService;
	notificationService: INotificationService;
	logService: ILogService;
	preferencesService: IPreferencesService;
	onActionSelected: (query: string, mode: ChatModeKind) => void;
}

/**
 * AssistantPanel component.
 * A centered modal dialog for notebook assistant actions, showing context, settings, and actions.
 */
export const AssistantPanel = (props: AssistantPanelProps) => {
	const {
		notebook,
		renderer,
		commandService,
		notificationService,
		logService,
		preferencesService,
		onActionSelected
	} = props;
	const [notebookContext, setNotebookContext] = useState<INotebookContextDTO | undefined>(undefined);
	const [isLoading, setIsLoading] = useState(true);

	// Fetch notebook context on mount
	useEffect(() => {
		const fetchContext = async () => {
			setIsLoading(true);
			try {
				const context = await notebook.getAssistantContext();
				setNotebookContext(context);
			} catch (error) {
				console.error('Failed to fetch notebook context:', error);
			} finally {
				setIsLoading(false);
			}
		};
		fetchContext();
	}, [notebook]);

	const handleClose = useCallback(() => {
		renderer.dispose();
	}, [renderer]);

	const handleOpenSettings = useCallback(async () => {
		handleClose();
		await preferencesService.openSettings({ query: 'positron.assistant.notebook' });
	}, [handleClose, preferencesService]);

	// Render using PositronModalDialog for centered positioning
	// Modal size: 400x450 (standard medium modal size in Positron)
	return (
		<PositronModalDialog
			closeOnClickOutside={true}
			height={450}
			renderer={renderer}
			title={localize('assistantPanel.title', 'Positron Notebook Assistant')}
			width={400}
			onCancel={handleClose}
		>
			<button
				aria-label={localize('assistantPanel.settings.openLabel', 'Open Notebook AI Settings')}
				className='assistant-panel-settings-icon codicon codicon-settings-gear'
				title={localize('assistantPanel.settings.openTooltip', 'Open Notebook AI Settings')}
				onClick={handleOpenSettings}
			/>
			<ContentArea>
				<div className='assistant-panel-content'>
					<AssistantPanelContext
						context={notebookContext}
						isLoading={isLoading}
					/>
					<div className='assistant-panel-section-divider' />
					<AssistantPanelActions
						commandService={commandService}
						logService={logService}
						notebook={notebook}
						notificationService={notificationService}
						onActionSelected={(query, mode) => {
							handleClose();
							onActionSelected(query, mode);
						}}
						onClose={handleClose}
					/>
				</div>
			</ContentArea>
		</PositronModalDialog>
	);
};
