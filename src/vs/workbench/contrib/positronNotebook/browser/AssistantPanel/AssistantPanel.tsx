/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './AssistantPanel.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
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
import { CancelablePromise } from '../../../../../base/common/async.js';
import { isCancellationError } from '../../../../../base/common/errors.js';

// Localized strings.
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

/**
 * AssistantPanelProps interface.
 * Services are passed directly as props (explicit dependency pattern).
 */
export interface AssistantPanelProps {
	/** The notebook instance if already available (fast path) */
	initialNotebook: IPositronNotebookInstance | undefined;
	/** Promise that resolves to the notebook instance (used when initialNotebook is undefined) */
	notebookPromise: CancelablePromise<IPositronNotebookInstance> | undefined;
	renderer: PositronModalReactRenderer;
	commandService: ICommandService;
	notificationService: INotificationService;
	logService: ILogService;
	preferencesService: IPreferencesService;
	onActionSelected: (query: string, mode: ChatModeKind) => void;
}

/**
 * Hook to wait for notebook instance availability via promise.
 * If initialNotebook is provided, returns ready state immediately.
 * Otherwise awaits the notebookPromise.
 */
function useWaitForNotebook(
	initialNotebook: IPositronNotebookInstance | undefined,
	notebookPromise: CancelablePromise<IPositronNotebookInstance> | undefined,
	logService: ILogService
): PanelState {
	const [state, setState] = useState<PanelState>(() =>
		initialNotebook
			? { status: 'ready', notebook: initialNotebook }
			: { status: 'pending' }
	);

	useEffect(() => {
		// If already ready or no promise to wait for, nothing to do
		if (state.status === 'ready' || !notebookPromise) {
			return;
		}

		let disposed = false;

		notebookPromise
			.then(notebook => {
				if (!disposed) {
					setState({ status: 'ready', notebook });
				}
			})
			.catch(error => {
				if (!disposed && !isCancellationError(error)) {
					logService.error('Failed to get notebook instance:', error);
					setState({
						status: 'error',
						message: error instanceof Error ? error.message : String(error)
					});
				}
				// On cancellation, do nothing - component is likely unmounting
			});

		return () => {
			disposed = true;
		};
	}, [notebookPromise, state.status, logService]);

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
		notebookPromise,
		renderer,
		commandService,
		notificationService,
		logService,
		preferencesService,
		onActionSelected
	} = props;

	// Wait for notebook availability via promise
	const panelState = useWaitForNotebook(initialNotebook, notebookPromise, logService);

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
				if (!controller) {
					logService.warn('PositronNotebookAssistantController not found for notebook. Contribution may not be registered.');
				}
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
