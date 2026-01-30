/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './AssistantPanel.css';

// React.
import { useEffect, useState } from 'react';

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
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IChatEditingService, IModifiedFileEntry, ModifiedFileEntryState } from '../../../chat/common/editing/chatEditingService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { POSITRON_NOTEBOOK_ASSISTANT_SHOW_DIFF_KEY, POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY, POSITRON_NOTEBOOK_GHOST_CELL_SUGGESTIONS_KEY } from '../../common/positronNotebookConfig.js';
import { CellEditType } from '../../../notebook/common/notebookCommon.js';
import { ShowDiffOverride, AutoFollowOverride, GhostCellSuggestionsOverride, getAssistantSettings, setAssistantSettings } from '../../common/notebookAssistantMetadata.js';

// Localized strings.
const loadingText = localize('assistantPanel.loading', 'Preparing notebook assistant...');
const closeButtonLabel = localize('assistantPanel.close', 'Close');
const actionsHeader = localize('assistantPanel.actions.header', 'Ask Assistant To');
const panelTitle = localize('assistantPanel.title', 'Positron Notebook Assistant');
const settingsHeader = localize('assistantPanel.settings.header', 'Notebook Settings');
const showDiffLabel = localize('assistantPanel.showDiff.label', 'Show edit diffs');
const showDiffTooltip = localize('assistantPanel.showDiff.tooltip', 'When enabled, assistant edits appear as inline diffs so you can review changes before accepting them');
const autoFollowLabel = localize('assistantPanel.autoFollow.label', 'Auto-follow edits');
const autoFollowTooltip = localize('assistantPanel.autoFollow.tooltip', 'When enabled, automatically scroll to cells modified by the AI assistant');
const ghostCellSuggestionsLabel = localize('assistantPanel.ghostCellSuggestions.label', 'Ghost cell suggestions');
const ghostCellSuggestionsTooltip = localize('assistantPanel.ghostCellSuggestions.tooltip', 'When enabled, show AI-generated suggestions for the next cell after successful execution');
const followGlobalLabel = localize('assistantPanel.followGlobal', 'follow global');
const yesLabel = localize('assistantPanel.yes', 'yes');
const noLabel = localize('assistantPanel.no', 'no');
const openGlobalSettingsLabel = localize('assistantPanel.settings.openGlobal', 'Open global settings');

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
 * Positron Assistant Notebook Metadata Schema
 * ===========================================
 *
 * Per-notebook assistant preferences are stored in notebook metadata at:
 *   notebook.metadata.positron.assistant.*
 *
 * Schema and helper functions are defined in:
 *   src/vs/workbench/contrib/positronNotebook/common/notebookAssistantMetadata.ts (workbench)
 *   extensions/positron-assistant/src/notebookAssistantMetadata.ts (extension)
 *
 * When adding new settings:
 *   1. Add the property to AssistantSettings interface in both modules
 *   2. Add validation in getAssistantSettings() if needed
 *   3. Add UI controls in the ReadyState component's settings section
 *   4. Register global fallback in positronNotebookConfig.ts
 */

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
	chatEditingService: IChatEditingService;
	commandService: ICommandService;
	configurationService: IConfigurationService;
	dialogService: IDialogService;
	notificationService: INotificationService;
	logService: ILogService;
	preferencesService: IPreferencesService;
	onActionSelected: (query: string, mode: ChatModeKind) => void | Promise<void>;
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
	showDiffOverride: ShowDiffOverride;
	globalShowDiff: boolean;
	onShowDiffChanged: (value: ShowDiffOverride) => void;
	autoFollowOverride: AutoFollowOverride;
	globalAutoFollow: boolean;
	onAutoFollowChanged: (value: AutoFollowOverride) => void;
	ghostCellSuggestionsOverride: GhostCellSuggestionsOverride;
	globalGhostCellSuggestions: boolean;
	onGhostCellSuggestionsChanged: (value: GhostCellSuggestionsOverride) => void;
	onOpenSettings: () => void;
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
	showDiffOverride,
	globalShowDiff,
	onShowDiffChanged,
	autoFollowOverride,
	globalAutoFollow,
	onAutoFollowChanged,
	ghostCellSuggestionsOverride,
	globalGhostCellSuggestions,
	onGhostCellSuggestionsChanged,
	onOpenSettings,
	onActionSelected,
	onClose
}: ReadyStateProps) => {
	// Effective value: use override if set, otherwise use global
	const effectiveShowDiff = showDiffOverride !== undefined
		? showDiffOverride === 'showDiff'
		: globalShowDiff;
	const effectiveAutoFollow = autoFollowOverride !== undefined
		? autoFollowOverride === 'autoFollow'
		: globalAutoFollow;
	const effectiveGhostCellSuggestions = ghostCellSuggestionsOverride !== undefined
		? ghostCellSuggestionsOverride === 'enabled'
		: globalGhostCellSuggestions;

	return (
		<>
			<div className='assistant-panel-section-header'>
				{settingsHeader}
			</div>
			<div className='assistant-panel-settings-section'>
				<div className='assistant-panel-setting-row'>
					{/* Setting label */}
					<span className='assistant-panel-setting-label'>
						{showDiffLabel}
						<span className='assistant-panel-setting-info codicon codicon-info' title={showDiffTooltip} />
					</span>

					{/* Controls aligned right */}
					<div className='assistant-panel-setting-controls'>
						{/* Follow global checkbox */}
						<label className='assistant-panel-follow-global-label'>
							{followGlobalLabel}
							<input
								checked={showDiffOverride === undefined}
								className='assistant-panel-checkbox'
								type='checkbox'
								onChange={(e) => {
									if (e.target.checked) {
										onShowDiffChanged(undefined);
									} else {
										onShowDiffChanged(globalShowDiff ? 'showDiff' : 'noDiff');
									}
								}}
							/>
							<span className='assistant-panel-checkbox-indicator' />
						</label>

						{/* Yes/No toggle - styled like ActionBarToggle */}
						<div className='assistant-panel-toggle'>
							<button
								aria-checked={effectiveShowDiff}
								aria-label={showDiffLabel}
								className={`toggle-container ${showDiffOverride === undefined ? 'disabled' : ''}`}
								disabled={showDiffOverride === undefined}
								onClick={() => onShowDiffChanged(effectiveShowDiff ? 'noDiff' : 'showDiff')}
							>
								<div className={`toggle-button left ${effectiveShowDiff ? 'highlighted' : ''}`}>
									{yesLabel}
								</div>
								<div className={`toggle-button right ${!effectiveShowDiff ? 'highlighted' : ''}`}>
									{noLabel}
								</div>
							</button>
						</div>
					</div>
				</div>

				<div className='assistant-panel-setting-row'>
					{/* Setting label */}
					<span className='assistant-panel-setting-label'>
						{autoFollowLabel}
						<span className='assistant-panel-setting-info codicon codicon-info' title={autoFollowTooltip} />
					</span>

					{/* Controls aligned right */}
					<div className='assistant-panel-setting-controls'>
						{/* Follow global checkbox */}
						<label className='assistant-panel-follow-global-label'>
							{followGlobalLabel}
							<input
								checked={autoFollowOverride === undefined}
								className='assistant-panel-checkbox'
								type='checkbox'
								onChange={(e) => {
									if (e.target.checked) {
										onAutoFollowChanged(undefined);
									} else {
										onAutoFollowChanged(globalAutoFollow ? 'autoFollow' : 'noAutoFollow');
									}
								}}
							/>
							<span className='assistant-panel-checkbox-indicator' />
						</label>

						{/* Yes/No toggle - styled like ActionBarToggle */}
						<div className='assistant-panel-toggle'>
							<button
								aria-checked={effectiveAutoFollow}
								aria-label={autoFollowLabel}
								className={`toggle-container ${autoFollowOverride === undefined ? 'disabled' : ''}`}
								disabled={autoFollowOverride === undefined}
								onClick={() => onAutoFollowChanged(effectiveAutoFollow ? 'noAutoFollow' : 'autoFollow')}
							>
								<div className={`toggle-button left ${effectiveAutoFollow ? 'highlighted' : ''}`}>
									{yesLabel}
								</div>
								<div className={`toggle-button right ${!effectiveAutoFollow ? 'highlighted' : ''}`}>
									{noLabel}
								</div>
							</button>
						</div>
					</div>
				</div>

				<div className='assistant-panel-setting-row'>
					{/* Setting label */}
					<span className='assistant-panel-setting-label'>
						{ghostCellSuggestionsLabel}
						<span className='assistant-panel-setting-info codicon codicon-info' title={ghostCellSuggestionsTooltip} />
					</span>

					{/* Controls aligned right */}
					<div className='assistant-panel-setting-controls'>
						{/* Follow global checkbox */}
						<label className='assistant-panel-follow-global-label'>
							{followGlobalLabel}
							<input
								checked={ghostCellSuggestionsOverride === undefined}
								className='assistant-panel-checkbox'
								type='checkbox'
								onChange={(e) => {
									if (e.target.checked) {
										onGhostCellSuggestionsChanged(undefined);
									} else {
										onGhostCellSuggestionsChanged(globalGhostCellSuggestions ? 'enabled' : 'disabled');
									}
								}}
							/>
							<span className='assistant-panel-checkbox-indicator' />
						</label>

						{/* Yes/No toggle - styled like ActionBarToggle */}
						<div className='assistant-panel-toggle'>
							<button
								aria-checked={effectiveGhostCellSuggestions}
								aria-label={ghostCellSuggestionsLabel}
								className={`toggle-container ${ghostCellSuggestionsOverride === undefined ? 'disabled' : ''}`}
								disabled={ghostCellSuggestionsOverride === undefined}
								onClick={() => onGhostCellSuggestionsChanged(effectiveGhostCellSuggestions ? 'disabled' : 'enabled')}
							>
								<div className={`toggle-button left ${effectiveGhostCellSuggestions ? 'highlighted' : ''}`}>
									{yesLabel}
								</div>
								<div className={`toggle-button right ${!effectiveGhostCellSuggestions ? 'highlighted' : ''}`}>
									{noLabel}
								</div>
							</button>
						</div>
					</div>
				</div>

				<button className='assistant-panel-settings-link' onClick={onOpenSettings}>
					<span className='codicon codicon-gear' />
					<span className='assistant-panel-settings-link-text'>{openGlobalSettingsLabel}</span>
				</button>
			</div>
			<div className='assistant-panel-section-divider' />
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
};

// Localized strings for pending diffs confirmation dialog.
const pendingDiffsTitle = localize('positronNotebook.assistant.pendingDiffs.title', 'Pending Edits');
const pendingDiffsMessage = localize('positronNotebook.assistant.pendingDiffs.message',
	'You have unconfirmed edits in this notebook. What would you like to do with them?');
const acceptPendingLabel = localize('positronNotebook.assistant.acceptPending', 'Accept Pending Edits');
const rejectPendingLabel = localize('positronNotebook.assistant.rejectPending', 'Reject Pending Edits');

/**
 * Show a confirmation dialog for pending diffs when changing the diff view setting.
 * @returns 'accept' if user chose to accept, 'reject' if user chose to reject, 'cancel' if cancelled
 */
async function showPendingDiffsConfirmation(
	entry: IModifiedFileEntry,
	dialogService: IDialogService
): Promise<'accept' | 'reject' | 'cancel'> {
	const { result } = await dialogService.prompt({
		title: pendingDiffsTitle,
		message: pendingDiffsMessage,
		type: 'info',
		cancelButton: true,
		buttons: [
			{
				label: acceptPendingLabel,
				run: async () => {
					await entry.accept();
					return 'accept' as const;
				}
			},
			{
				label: rejectPendingLabel,
				run: async () => {
					await entry.reject();
					return 'reject' as const;
				}
			}
		],
	});

	return result ?? 'cancel';
}

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
		chatEditingService,
		commandService,
		configurationService,
		dialogService,
		notificationService,
		logService,
		preferencesService,
		onActionSelected
	} = props;

	// Panel state for tracking notebook availability
	const [panelState, setPanelState] = useState<PanelState>(() =>
		initialNotebook
			? { status: 'ready', notebook: initialNotebook }
			: { status: 'pending' }
	);

	// Wait for notebook availability via promise
	useEffect(() => {
		// If already ready or no promise to wait for, nothing to do
		if (panelState.status === 'ready' || !notebookPromise) {
			return;
		}

		let disposed = false;

		notebookPromise
			.then(notebook => {
				if (!disposed) {
					setPanelState({ status: 'ready', notebook });
				}
			})
			.catch(error => {
				if (!disposed && !isCancellationError(error)) {
					logService.error('Failed to get notebook instance:', error);
					setPanelState({
						status: 'error',
						message: error instanceof Error ? error.message : String(error)
					});
				}
				// On cancellation, do nothing - component is likely unmounting
			});

		return () => {
			disposed = true;
		};
	}, [notebookPromise, panelState.status, logService]);

	// State for notebook context (only used when ready)
	const [notebookContext, setNotebookContext] = useState<INotebookContextDTO | undefined>(undefined);
	const [isLoadingContext, setIsLoadingContext] = useState(true);

	// State for show diff setting
	const [showDiffOverride, setShowDiffOverride] = useState<ShowDiffOverride>(undefined);
	const globalShowDiff = configurationService.getValue<boolean>(POSITRON_NOTEBOOK_ASSISTANT_SHOW_DIFF_KEY) ?? true;

	// State for auto-follow setting
	const [autoFollowOverride, setAutoFollowOverride] = useState<AutoFollowOverride>(undefined);
	const globalAutoFollow = configurationService.getValue<boolean>(POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY) ?? true;

	// State for ghost cell suggestions setting
	const [ghostCellSuggestionsOverride, setGhostCellSuggestionsOverride] = useState<GhostCellSuggestionsOverride>(undefined);
	const globalGhostCellSuggestions = configurationService.getValue<boolean>(POSITRON_NOTEBOOK_GHOST_CELL_SUGGESTIONS_KEY) ?? true;

	// Load settings overrides from notebook metadata when notebook becomes available
	useEffect(() => {
		if (panelState.status !== 'ready') {
			return;
		}

		const settings = getAssistantSettings(panelState.notebook.textModel?.metadata);
		setShowDiffOverride(settings.showDiff);
		setAutoFollowOverride(settings.autoFollow);
		setGhostCellSuggestionsOverride(settings.ghostCellSuggestions);
	}, [panelState]);

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

	const handleShowDiffChanged = async (value: ShowDiffOverride) => {
		if (panelState.status !== 'ready') {
			return;
		}

		// Check for pending diffs in any editing session
		let pendingEntry: IModifiedFileEntry | undefined;
		for (const session of chatEditingService.editingSessionsObs.get()) {
			const entry = session.getEntry(panelState.notebook.uri);
			if (entry && entry.state.get() === ModifiedFileEntryState.Modified) {
				pendingEntry = entry;
				break;
			}
		}

		if (pendingEntry) {
			// Show confirmation dialog - if cancelled, don't change the setting
			const action = await showPendingDiffsConfirmation(pendingEntry, dialogService);
			if (action === 'cancel') {
				return;
			}
		}

		// Apply the setting change
		setShowDiffOverride(value);

		const textModel = panelState.notebook.textModel;
		if (!textModel) {
			logService.warn('Cannot update notebook metadata: no text model available');
			return;
		}

		const newMetadata = setAssistantSettings({ ...textModel.metadata }, { showDiff: value });
		textModel.applyEdits([{
			editType: CellEditType.DocumentMetadata,
			metadata: newMetadata
		}], true, undefined, () => undefined, undefined, true);
	};

	const handleAutoFollowChanged = (value: AutoFollowOverride) => {
		if (panelState.status !== 'ready') {
			return;
		}

		// Apply the setting change
		setAutoFollowOverride(value);

		const textModel = panelState.notebook.textModel;
		if (!textModel) {
			logService.warn('Cannot update notebook metadata: no text model available');
			return;
		}

		const newMetadata = setAssistantSettings({ ...textModel.metadata }, { autoFollow: value });
		textModel.applyEdits([{
			editType: CellEditType.DocumentMetadata,
			metadata: newMetadata
		}], true, undefined, () => undefined, undefined, true);
	};

	const handleGhostCellSuggestionsChanged = (value: GhostCellSuggestionsOverride) => {
		if (panelState.status !== 'ready') {
			return;
		}

		// Apply the setting change
		setGhostCellSuggestionsOverride(value);

		const textModel = panelState.notebook.textModel;
		if (!textModel) {
			logService.warn('Cannot update notebook metadata: no text model available');
			return;
		}

		const newMetadata = setAssistantSettings({ ...textModel.metadata }, { ghostCellSuggestions: value });
		textModel.applyEdits([{
			editType: CellEditType.DocumentMetadata,
			metadata: newMetadata
		}], true, undefined, () => undefined, undefined, true);
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
						autoFollowOverride={autoFollowOverride}
						commandService={commandService}
						ghostCellSuggestionsOverride={ghostCellSuggestionsOverride}
						globalAutoFollow={globalAutoFollow}
						globalGhostCellSuggestions={globalGhostCellSuggestions}
						globalShowDiff={globalShowDiff}
						isLoadingContext={isLoadingContext}
						logService={logService}
						notebook={panelState.notebook}
						notebookContext={notebookContext}
						notificationService={notificationService}
						showDiffOverride={showDiffOverride}
						onActionSelected={handleActionSelected}
						onAutoFollowChanged={handleAutoFollowChanged}
						onClose={handleClose}
						onGhostCellSuggestionsChanged={handleGhostCellSuggestionsChanged}
						onOpenSettings={handleOpenSettings}
						onShowDiffChanged={handleShowDiffChanged}
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
			<ContentArea>
				<div className='assistant-panel-content'>
					{renderContent()}
				</div>
			</ContentArea>
		</PositronModalDialog>
	);
};
