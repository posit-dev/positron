/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './GhostCell.css';

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useObservedValue } from '../useObservedValue.js';
import { SplitButton } from '../utilityComponents/SplitButton.js';
import { GhostCellState } from '../IPositronNotebookInstance.js';
import { ScreenReaderOnly } from '../../../../../base/browser/ui/positronComponents/ScreenReaderOnly.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { GhostCellInfoModalDialog } from './GhostCellInfoModalDialog.js';
import { IAction } from '../../../../../base/common/actions.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

// Localized strings.
const loadingText = localize('ghostCell.loading', 'Generating suggestion...');
const acceptLabel = localize('ghostCell.accept', 'Accept');
const acceptAndRunLabel = localize('ghostCell.acceptAndRun', 'Accept and Run');
const acceptDropdownTooltip = localize('ghostCell.acceptDropdownTooltip', 'More accept options');
const dismissLabel = localize('ghostCell.dismiss', 'Dismiss');
const dontSuggestInNotebookLabel = localize('ghostCell.dontSuggestInNotebook', "Don't suggest in this notebook");
const dontSuggestAgainLabel = localize('ghostCell.dontSuggestAgain', "Don't suggest again");
const dismissDropdownTooltip = localize('ghostCell.dismissDropdownTooltip', 'More dismiss options');
const regenerateLabel = localize('ghostCell.regenerate', 'Regenerate');
const defaultExplanation = localize('ghostCell.defaultExplanation', 'Suggested next step');
const suggestionAvailableAnnouncement = localize('ghostCell.suggestionAvailable', 'AI suggestion available. Use Accept to insert the suggested code.');
const loadingAnnouncement = localize('ghostCell.loadingAnnouncement', 'Generating AI suggestion for next cell...');
const infoButtonLabel = localize('ghostCell.infoButton', 'About ghost cell suggestions');

// Opt-in prompt strings
const optInPromptText = localize('ghostCell.optInPrompt', 'Suggest code as you work? When you execute a cell, AI can recommend what to do next based on your notebook context.');
const optInEnableLabel = localize('ghostCell.optInEnable', 'Enable');
const optInNotNowLabel = localize('ghostCell.optInNotNow', 'Not now');
const optInDontAskLabel = localize('ghostCell.optInDontAsk', "Don't ask again");
const optInPromptAnnouncement = localize('ghostCell.optInPromptAnnouncement', 'Would you like AI to suggest code based on your notebook context?');
const learnMoreLabel = localize('ghostCell.learnMore', 'Learn more');

// Awaiting-request (pull mode) strings
const getSuggestionLabel = localize('ghostCell.getSuggestion', 'Get Suggestion');
const awaitingRequestAnnouncement = localize('ghostCell.awaitingRequestAnnouncement', 'AI suggestion available. Press the Get Suggestion button or use Cmd+Shift+G to request.');
const awaitingRequestText = localize('ghostCell.awaitingRequestText', 'AI suggestion available on request');

// Mode toggle strings
const automaticModeLabel = localize('ghostCell.automaticMode', 'Automatic');
const onDemandModeLabel = localize('ghostCell.onDemandMode', 'On-demand');
const modeToggleTooltip = localize('ghostCell.modeToggleTooltip', 'Toggle suggestion mode');

// Model fallback warning
const fallbackWarningTooltip = localize('ghostCell.fallbackWarning', 'Configured model unavailable, using fallback');

// Model picker
const changeModelTooltip = localize('ghostCell.changeModel', 'Change model');

// Expand/collapse strings
const showMoreLabel = localize('ghostCell.showMore', 'Show more');
const showLessLabel = localize('ghostCell.showLess', 'Show less');

/**
 * Props for TruncatedExplanation component
 */
interface TruncatedExplanationProps {
	text: string;
}

/**
 * TruncatedExplanation component - displays explanation text with expand/collapse when truncated
 */
const TruncatedExplanation: React.FC<TruncatedExplanationProps> = ({ text }) => {
	const spanRef = React.useRef<HTMLSpanElement>(null);
	const [isTruncated, setIsTruncated] = React.useState(false);
	const [isExpanded, setIsExpanded] = React.useState(false);

	React.useEffect(() => {
		const checkTruncation = () => {
			if (spanRef.current && !isExpanded) {
				setIsTruncated(spanRef.current.scrollWidth > spanRef.current.clientWidth);
			}
		};

		checkTruncation();

		const resizeObserver = new ResizeObserver(checkTruncation);
		if (spanRef.current) {
			resizeObserver.observe(spanRef.current);
		}

		return () => resizeObserver.disconnect();
	}, [text, isExpanded]);

	const handleToggle = () => {
		setIsExpanded(!isExpanded);
	};

	return (
		<span className={`ghost-cell-explanation ${isExpanded ? 'expanded' : ''}`}>
			<span ref={spanRef} className='ghost-cell-explanation-text'>
				{text}
			</span>
			{(isTruncated || isExpanded) && (
				<button
					className='ghost-cell-expand-button'
					onClick={handleToggle}
				>
					{isExpanded ? showLessLabel : showMoreLabel}
				</button>
			)}
		</span>
	);
};

/**
 * Props for SuggestionModeToggle component
 */
interface SuggestionModeToggleProps {
	automatic: boolean;
	onToggle: () => void;
}

/**
 * SuggestionModeToggle - a segmented toggle switch for automatic/on-demand mode
 * Styled to match the AssistantPanel toggle pattern.
 */
const SuggestionModeToggle: React.FC<SuggestionModeToggleProps> = ({ automatic, onToggle }) => (
	<div className='ghost-cell-mode-toggle'>
		<button
			aria-checked={automatic}
			aria-label={modeToggleTooltip}
			className='toggle-container'
			title={modeToggleTooltip}
			onClick={onToggle}
		>
			<div className={`toggle-button left ${automatic ? 'highlighted' : ''}`}>
				{automaticModeLabel}
			</div>
			<div className={`toggle-button right ${!automatic ? 'highlighted' : ''}`}>
				{onDemandModeLabel}
			</div>
		</button>
	</div>
);

/**
 * Props for GhostCellOptInPrompt component
 */
interface GhostCellOptInPromptProps {
	onEnable: () => void;
	onNotNow: () => void;
	onDontAskAgain: () => void;
	onShowInfo: () => void;
}

/**
 * GhostCellOptInPrompt component - displays opt-in prompt for ghost cell suggestions
 */
const GhostCellOptInPrompt: React.FC<GhostCellOptInPromptProps> = ({
	onEnable,
	onNotNow,
	onDontAskAgain,
	onShowInfo
}) => (
	<div className='ghost-cell-opt-in'>
		<div className='ghost-cell-opt-in-content'>
			<span className='ghost-cell-opt-in-text'>
				{optInPromptText}
				{' '}
				<Button
					ariaLabel={learnMoreLabel}
					className='ghost-cell-learn-more'
					onPressed={onShowInfo}
				>
					{learnMoreLabel}
				</Button>
			</span>
		</div>
		<div className='ghost-cell-opt-in-actions'>
			<Button
				ariaLabel={optInEnableLabel}
				className='ghost-cell-opt-in-button default'
				onPressed={onEnable}
			>
				{optInEnableLabel}
			</Button>
			<Button
				ariaLabel={optInNotNowLabel}
				className='ghost-cell-opt-in-button'
				onPressed={onNotNow}
			>
				{optInNotNowLabel}
			</Button>
			<Button
				ariaLabel={optInDontAskLabel}
				className='ghost-cell-opt-in-button'
				onPressed={onDontAskAgain}
			>
				{optInDontAskLabel}
			</Button>
		</div>
	</div>
);

/**
 * Props for GhostCellAwaitingRequest component
 */
interface GhostCellAwaitingRequestProps {
	onGetSuggestion: () => void;
	onDismiss: () => void;
	onShowInfo: () => void;
	automatic: boolean;
	onToggleMode: () => void;
}

/**
 * GhostCellAwaitingRequest component - displays on-demand mode placeholder with "Get Suggestion" button
 */
const GhostCellAwaitingRequest: React.FC<GhostCellAwaitingRequestProps> = ({
	onGetSuggestion,
	onDismiss,
	onShowInfo,
	automatic,
	onToggleMode
}) => (
	<div className='ghost-cell-awaiting-request'>
		<span className='ghost-cell-awaiting-text'>{awaitingRequestText}</span>
		<Button
			ariaLabel={getSuggestionLabel}
			className='ghost-cell-get-suggestion default'
			onPressed={onGetSuggestion}
		>
			{getSuggestionLabel}
		</Button>
		<Button
			ariaLabel={dismissLabel}
			className='ghost-cell-dismiss-button'
			onPressed={onDismiss}
		>
			{dismissLabel}
		</Button>
		<div className='ghost-cell-spacer' />
		<SuggestionModeToggle automatic={automatic} onToggle={onToggleMode} />
		<button
			aria-label={infoButtonLabel}
			className='ghost-cell-info-button codicon codicon-info'
			title={infoButtonLabel}
			onClick={onShowInfo}
		/>
	</div>
);

/**
 * GhostCellLoading component - displays loading state with spinner
 */
const GhostCellLoading: React.FC = () => (
	<div className='ghost-cell-loading'>
		<div className='ghost-cell-loading-spinner codicon codicon-loading codicon-modifier-spin' />
		<div className='ghost-cell-loading-text'>{loadingText}</div>
	</div>
);

/**
 * GhostCellError component - displays error state with message
 */
const GhostCellError: React.FC<{ message: string }> = ({ message }) => (
	<div className='ghost-cell-error'>
		<div className='ghost-cell-error-icon codicon codicon-warning' />
		<div className='ghost-cell-error-text'>{message}</div>
	</div>
);

/**
 * Props for GhostCellContent component
 */
interface GhostCellContentProps {
	code: string;
	explanation: string;
	isStreaming: boolean;
	onAcceptAndRun: () => void;
	onDismiss: () => void;
	onRegenerate: () => void;
	onShowInfo: () => void;
	onChangeModel: () => void;
	acceptActions: IAction[];
	dismissActions: IAction[];
	contextMenuService: ReturnType<typeof usePositronReactServicesContext>['contextMenuService'];
	automatic: boolean;
	onToggleMode: () => void;
	modelName?: string;
	usedFallback?: boolean;
}

/**
 * GhostCellContent component - displays the suggestion content with actions
 */
const GhostCellContent: React.FC<GhostCellContentProps> = ({
	code,
	explanation,
	isStreaming,
	onAcceptAndRun,
	onDismiss,
	onRegenerate,
	onShowInfo,
	onChangeModel,
	acceptActions,
	dismissActions,
	contextMenuService,
	automatic,
	onToggleMode,
	modelName,
	usedFallback
}) => {
	return (
		<>
			<div className='ghost-cell-header'>
				<div className='ghost-cell-header-content'>
					<TruncatedExplanation text={explanation || defaultExplanation} />
					<SuggestionModeToggle automatic={automatic} onToggle={onToggleMode} />
				</div>
				<div className='ghost-cell-actions'>
					<SplitButton
						ariaLabel={acceptAndRunLabel}
						className='ghost-cell-accept'
						contextMenuService={contextMenuService}
						disabled={isStreaming}
						dropdownActions={acceptActions}
						dropdownTooltip={acceptDropdownTooltip}
						label={acceptAndRunLabel}
						onMainAction={onAcceptAndRun}
					/>
					<SplitButton
						ariaLabel={dismissLabel}
						className='ghost-cell-dismiss'
						contextMenuService={contextMenuService}
						dropdownActions={dismissActions}
						dropdownTooltip={dismissDropdownTooltip}
						label={dismissLabel}
						onMainAction={onDismiss}
					/>
					<button
						aria-label={regenerateLabel}
						className='ghost-cell-regenerate codicon codicon-refresh'
						disabled={isStreaming}
						title={regenerateLabel}
						onClick={onRegenerate}
					/>
				</div>
			</div>
			<div className='ghost-cell-code-preview'>
				<pre className='ghost-cell-code-text'>{code}</pre>
			</div>
			<div className='ghost-cell-footer'>
				<button
					aria-label={infoButtonLabel}
					className='ghost-cell-info-button codicon codicon-info'
					title={infoButtonLabel}
					onClick={onShowInfo}
				/>
				{modelName && (
					<div className='ghost-cell-model-info'>
						{usedFallback && (
							<span
								className='ghost-cell-fallback-warning codicon codicon-warning'
								title={fallbackWarningTooltip}
							/>
						)}
						<button
							className='ghost-cell-model-indicator'
							title={changeModelTooltip}
							onClick={onChangeModel}
						>
							{modelName}
						</button>
					</div>
				)}
			</div>
		</>
	);
};

/**
 * Renders content based on ghost cell state
 */
function renderGhostCellState(
	state: GhostCellState,
	onAcceptAndRun: () => void,
	onDismiss: () => void,
	onRegenerate: () => void,
	onShowInfo: () => void,
	onChangeModel: () => void,
	acceptActions: IAction[],
	dismissActions: IAction[],
	contextMenuService: ReturnType<typeof usePositronReactServicesContext>['contextMenuService'],
	onOptInEnable: () => void,
	onOptInNotNow: () => void,
	onOptInDontAskAgain: () => void,
	onGetSuggestion: () => void,
	automatic: boolean,
	onToggleMode: () => void,
	modelName?: string,
	usedFallback?: boolean
): React.ReactNode {
	switch (state.status) {
		case 'hidden':
			return null;

		case 'opt-in-prompt':
			return (
				<GhostCellOptInPrompt
					onDontAskAgain={onOptInDontAskAgain}
					onEnable={onOptInEnable}
					onNotNow={onOptInNotNow}
					onShowInfo={onShowInfo}
				/>
			);

		case 'awaiting-request':
			return (
				<GhostCellAwaitingRequest
					automatic={automatic}
					onDismiss={onDismiss}
					onGetSuggestion={onGetSuggestion}
					onShowInfo={onShowInfo}
					onToggleMode={onToggleMode}
				/>
			);

		case 'loading':
			return <GhostCellLoading />;

		case 'streaming':
			return (
				<GhostCellContent
					acceptActions={acceptActions}
					automatic={automatic}
					code={state.code}
					contextMenuService={contextMenuService}
					dismissActions={dismissActions}
					explanation={state.explanation}
					isStreaming={true}
					onAcceptAndRun={onAcceptAndRun}
					onChangeModel={onChangeModel}
					onDismiss={onDismiss}
					onRegenerate={onRegenerate}
					onShowInfo={onShowInfo}
					onToggleMode={onToggleMode}
				/>
			);

		case 'ready':
			return (
				<GhostCellContent
					acceptActions={acceptActions}
					automatic={automatic}
					code={state.code}
					contextMenuService={contextMenuService}
					dismissActions={dismissActions}
					explanation={state.explanation}
					isStreaming={false}
					modelName={modelName}
					usedFallback={usedFallback}
					onAcceptAndRun={onAcceptAndRun}
					onChangeModel={onChangeModel}
					onDismiss={onDismiss}
					onRegenerate={onRegenerate}
					onShowInfo={onShowInfo}
					onToggleMode={onToggleMode}
				/>
			);

		case 'error':
			return <GhostCellError message={state.message} />;
	}
}

/**
 * Get the appropriate screen reader announcement for a ghost cell state
 */
function getAnnouncement(state: GhostCellState): string {
	switch (state.status) {
		case 'opt-in-prompt':
			return optInPromptAnnouncement;
		case 'awaiting-request':
			return awaitingRequestAnnouncement;
		case 'loading':
			return loadingAnnouncement;
		case 'ready':
			return suggestionAvailableAnnouncement;
		default:
			return '';
	}
}

/**
 * GhostCell component - displays AI-generated suggestions for the next notebook cell.
 * Appears after successful cell execution with a brief delay.
 */
export const GhostCell: React.FC = () => {
	const instance = useNotebookInstance();
	const services = usePositronReactServicesContext();
	const { contextMenuService, workbenchLayoutService } = services;
	const ghostCellState = useObservedValue(instance.ghostCellState);
	const [announcement, setAnnouncement] = React.useState('');
	const containerRef = React.useRef<HTMLDivElement>(null);

	// Track state changes to update announcements
	const prevStatusRef = React.useRef(ghostCellState.status);
	React.useEffect(() => {
		// Only announce when transitioning to loading or ready states
		if (prevStatusRef.current !== ghostCellState.status) {
			const newAnnouncement = getAnnouncement(ghostCellState);
			if (newAnnouncement) {
				setAnnouncement(newAnnouncement);
			}
			prevStatusRef.current = ghostCellState.status;
		}
	}, [ghostCellState]);

	const handleAccept = React.useCallback(() => {
		instance.acceptGhostCellSuggestion(false);
	}, [instance]);

	const handleAcceptAndRun = React.useCallback(() => {
		instance.acceptGhostCellSuggestion(true);
	}, [instance]);

	const handleDismiss = React.useCallback(() => {
		instance.dismissGhostCell(false);
	}, [instance]);

	const handleDisableForNotebook = React.useCallback(() => {
		instance.dismissGhostCell(true);
	}, [instance]);

	const handleDisableGlobally = React.useCallback(() => {
		instance.disableGhostCellSuggestions();
	}, [instance]);

	const handleRegenerate = React.useCallback(() => {
		instance.regenerateGhostCellSuggestion();
	}, [instance]);

	const handleShowInfo = React.useCallback(() => {
		const renderer = new PositronModalReactRenderer({
			container: workbenchLayoutService.getContainer(DOM.getWindow(containerRef.current))
		});
		// Extract modelName from state if available
		const modelName = ghostCellState.status === 'ready' ? ghostCellState.modelName : undefined;
		renderer.render(<GhostCellInfoModalDialog modelName={modelName} renderer={renderer} />);
	}, [workbenchLayoutService, ghostCellState]);

	// Opt-in prompt handlers
	const handleOptInEnable = React.useCallback(() => {
		instance.enableGhostCellSuggestions();
	}, [instance]);

	const handleOptInNotNow = React.useCallback(() => {
		instance.dismissOptInPrompt();
	}, [instance]);

	const handleOptInDontAskAgain = React.useCallback(() => {
		instance.disableGhostCellSuggestions();
	}, [instance]);

	// Pull mode handler - request suggestion on demand
	const handleGetSuggestion = React.useCallback(() => {
		instance.requestGhostCellSuggestion();
	}, [instance]);

	// Mode toggle handler
	const handleToggleMode = React.useCallback(() => {
		instance.toggleAutomaticMode();
	}, [instance]);

	// Model picker handler
	const handleChangeModel = React.useCallback(() => {
		services.commandService.executeCommand('positron-assistant.selectGhostCellModel');
	}, [services.commandService]);

	// Get automatic mode from state (for immediate UI feedback) or fall back to instance method
	const automatic = ghostCellState.status !== 'hidden' && ghostCellState.status !== 'opt-in-prompt' && ghostCellState.status !== 'error'
		? ghostCellState.automatic
		: instance.isAutomaticMode();

	// Memoize actions for the split buttons
	// Dropdown shows alternatives to the primary action (Accept and Run)
	const acceptActions = React.useMemo((): IAction[] => [
		{
			id: 'ghost-cell-accept',
			label: acceptLabel,
			tooltip: acceptLabel,
			class: undefined,
			enabled: true,
			run: handleAccept
		}
	], [handleAccept]);

	const dismissActions = React.useMemo((): IAction[] => [
		{
			id: 'ghost-cell-dismiss',
			label: dismissLabel,
			tooltip: dismissLabel,
			class: undefined,
			enabled: true,
			run: handleDismiss
		},
		{
			id: 'ghost-cell-disable-for-notebook',
			label: dontSuggestInNotebookLabel,
			tooltip: dontSuggestInNotebookLabel,
			class: undefined,
			enabled: true,
			run: handleDisableForNotebook
		},
		{
			id: 'ghost-cell-dont-suggest-again',
			label: dontSuggestAgainLabel,
			tooltip: dontSuggestAgainLabel,
			class: undefined,
			enabled: true,
			run: handleDisableGlobally
		}
	], [handleDismiss, handleDisableForNotebook, handleDisableGlobally]);

	// Don't render anything if ghost cell is hidden
	if (ghostCellState.status === 'hidden') {
		return null;
	}

	// Determine CSS class based on state
	const containerClass = ghostCellState.status === 'streaming'
		? 'ghost-cell ghost-cell-streaming'
		: 'ghost-cell';

	return (
		<div
			ref={containerRef}
			aria-label={localize('ghostCell.ariaLabel', 'AI suggestion for next cell')}
			className={containerClass}
		>
			<div className='ghost-cell-container'>
				{renderGhostCellState(
					ghostCellState,
					handleAcceptAndRun,
					handleDismiss,
					handleRegenerate,
					handleShowInfo,
					handleChangeModel,
					acceptActions,
					dismissActions,
					contextMenuService,
					handleOptInEnable,
					handleOptInNotNow,
					handleOptInDontAskAgain,
					handleGetSuggestion,
					automatic,
					handleToggleMode,
					ghostCellState.status === 'ready' ? ghostCellState.modelName : undefined,
					ghostCellState.status === 'ready' ? ghostCellState.usedFallback : undefined
				)}
			</div>
			<ScreenReaderOnly className='ghost-cell-announcements'>
				{announcement}
			</ScreenReaderOnly>
		</div>
	);
};
