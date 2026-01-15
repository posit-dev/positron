/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './AssistantPanel.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';
import { PositronNotebookAssistantController } from '../contrib/assistant/controller.js';
import { AssistantPanelContext } from './AssistantPanelContext.js';
import { AssistantPanelActions } from './AssistantPanelActions.js';
import { INotebookContextDTO } from '../../../../common/positron/notebookAssistant.js';
import { ChatModeKind } from '../../../chat/common/constants.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';

// Localized strings.
const notebookTimeoutMessage = localize('assistantPanel.notebookTimeout', 'Notebook is taking too long to load. Please close this dialog and try again.');
const loadingText = localize('assistantPanel.loading', 'Preparing notebook assistant...');
const closeButtonLabel = localize('assistantPanel.close', 'Close');
const actionsHeader = localize('assistantPanel.actions.header', 'Ask Assistant To');
const panelTitle = localize('assistantPanel.title', 'Positron Notebook Assistant');
const settingsAriaLabel = localize('assistantPanel.settings.openLabel', 'Open Notebook AI Settings');
const settingsTooltip = localize('assistantPanel.settings.openTooltip', 'Open Notebook AI Settings');

/**
 * Panel state for tracking notebook availability
 */
type PanelState = {
	status: 'pending';
} | {
	status: 'ready';
	notebook: IPositronNotebookInstance;
} | {
	status: 'error';
	message: string;
};

const NOTEBOOK_TIMEOUT_MS = 5000; // 5 seconds timeout
const NOTEBOOK_POLL_INTERVAL_MS = 100; // Poll every 100ms

/**
 * AssistantPanelProps interface.
 * Services are passed directly as props (explicit dependency pattern).
 */
export interface AssistantPanelProps {
	initialNotebook: IPositronNotebookInstance | undefined;
	getNotebook: () => IPositronNotebookInstance | undefined;
	renderer: PositronModalReactRenderer;
	commandService: ICommandService;
	notificationService: INotificationService;
	logService: ILogService;
	preferencesService: IPreferencesService;
	onActionSelected: (query: string, mode: ChatModeKind) => void;
}

/**
 * Hook to poll for notebook instance availability
 */
function useNotebookPolling(
	initialNotebook: IPositronNotebookInstance | undefined,
	getNotebook: () => IPositronNotebookInstance | undefined
): PanelState {
	const [state, setState] = useState<PanelState>(() =>
		initialNotebook
			? { status: 'ready', notebook: initialNotebook }
			: { status: 'pending' }
	);

	useEffect(() => {
		// If already ready, nothing to do
		if (state.status === 'ready') {
			return;
		}

		const targetWindow = DOM.getActiveWindow();
		let elapsed = 0;
		const intervalId = targetWindow.setInterval(() => {
			const notebook = getNotebook();
			if (notebook) {
				setState({ status: 'ready', notebook });
				targetWindow.clearInterval(intervalId);
				return;
			}

			elapsed += NOTEBOOK_POLL_INTERVAL_MS;
			if (elapsed >= NOTEBOOK_TIMEOUT_MS) {
				setState({
					status: 'error',
					message: notebookTimeoutMessage
				});
				targetWindow.clearInterval(intervalId);
			}
		}, NOTEBOOK_POLL_INTERVAL_MS);

		return () => targetWindow.clearInterval(intervalId);
	}, [getNotebook, state.status]);

	return state;
}

/**
 * PendingState component.
 * Displays a loading spinner while waiting for the notebook to become available.
 */
const PendingState = () => (
	<div className='assistant-panel-loading'>
		<div className='assistant-panel-loading-spinner codicon codicon-loading codicon-modifier-spin' />
		<div className='assistant-panel-loading-text'>
			{loadingText}
		</div>
	</div>
);

/**
 * ErrorStateProps interface.
 */
interface ErrorStateProps {
	message: string;
	onClose: () => void;
}

/**
 * ErrorState component.
 * Displays an error message with a close button.
 */
const ErrorState = ({ message, onClose }: ErrorStateProps) => (
	<div className='assistant-panel-error'>
		<div className='assistant-panel-error-icon codicon codicon-warning' />
		<div className='assistant-panel-error-text'>{message}</div>
		<button
			className='assistant-panel-error-close'
			onClick={onClose}
		>
			{closeButtonLabel}
		</button>
	</div>
);

/**
 * ReadyStateProps interface.
 */
interface ReadyStateProps {
	notebook: IPositronNotebookInstance;
	notebookContext: INotebookContextDTO | undefined;
	isLoadingContext: boolean;
	commandService: ICommandService;
	logService: ILogService;
	notificationService: INotificationService;
	onActionSelected: (query: string, mode: ChatModeKind) => void;
	onClose: () => void;
}

/**
 * ReadyState component.
 * Displays the full panel content when the notebook is ready.
 */
const ReadyState = ({
	notebook,
	notebookContext,
	isLoadingContext,
	commandService,
	logService,
	notificationService,
	onActionSelected,
	onClose
}: ReadyStateProps) => (
	<>
		<AssistantPanelContext
			context={notebookContext}
			isLoading={isLoadingContext}
		/>
		<div className='assistant-panel-section-divider' />
		<div className='assistant-panel-section-header'>
			{actionsHeader}
		</div>
		<AssistantPanelActions
			commandService={commandService}
			logService={logService}
			notebook={notebook}
			notificationService={notificationService}
			onActionSelected={onActionSelected}
			onClose={onClose}
		/>
	</>
);

/**
 * AssistantPanel component.
 * A centered modal dialog for notebook assistant actions, showing context, settings, and actions.
 * Supports optimistic loading: shows immediately even if notebook instance isn't ready yet.
 */
export const AssistantPanel = (props: AssistantPanelProps) => {
	const {
		initialNotebook,
		getNotebook,
		renderer,
		commandService,
		notificationService,
		logService,
		preferencesService,
		onActionSelected
	} = props;

	// Poll for notebook availability
	const panelState = useNotebookPolling(initialNotebook, getNotebook);

	// State for notebook context (only used when ready)
	const [notebookContext, setNotebookContext] = useState<INotebookContextDTO | undefined>(undefined);
	const [isLoadingContext, setIsLoadingContext] = useState(true);

	// Fetch notebook context when notebook becomes available
	useEffect(() => {
		if (panelState.status !== 'ready') {
			return;
		}

		const fetchContext = async () => {
			setIsLoadingContext(true);
			try {
				const controller = PositronNotebookAssistantController.get(panelState.notebook);
				const context = await controller?.getAssistantContext();
				setNotebookContext(context);
			} catch (error) {
				logService.error('Failed to fetch notebook context:', error);
			} finally {
				setIsLoadingContext(false);
			}
		};
		fetchContext();
	}, [panelState, logService]);

	const handleClose = () => {
		renderer.dispose();
	};

	const handleOpenSettings = async () => {
		renderer.dispose();
		await preferencesService.openSettings({ query: 'positron.assistant.notebook' });
	};

	const handleActionSelected = (query: string, mode: ChatModeKind) => {
		renderer.dispose();
		onActionSelected(query, mode);
	};

	// Determine content based on state
	const renderContent = () => {
		switch (panelState.status) {
			case 'pending':
				return <PendingState />;
			case 'error':
				return <ErrorState message={panelState.message} onClose={handleClose} />;
			case 'ready':
				return (
					<ReadyState
						commandService={commandService}
						isLoadingContext={isLoadingContext}
						logService={logService}
						notebook={panelState.notebook}
						notebookContext={notebookContext}
						notificationService={notificationService}
						onActionSelected={handleActionSelected}
						onClose={handleClose}
					/>
				);
		}
	};

	return (
		<PositronModalDialog
			closeOnClickOutside={true}
			height={450}
			renderer={renderer}
			title={panelTitle}
			width={400}
			onCancel={handleClose}
		>
			<button
				aria-label={settingsAriaLabel}
				className='assistant-panel-settings-icon codicon codicon-settings-gear'
				title={settingsTooltip}
				onClick={handleOpenSettings}
			/>
			<ContentArea>
				<div className='assistant-panel-content'>
					{renderContent()}
				</div>
			</ContentArea>
		</PositronModalDialog>
	);
};
