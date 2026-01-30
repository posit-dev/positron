/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './GhostCell.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useObservedValue } from '../useObservedValue.js';
import { SplitButton } from '../utilityComponents/SplitButton.js';
import { GhostCellState } from '../IPositronNotebookInstance.js';
import { ScreenReaderOnly } from '../../../../../base/browser/ui/positronComponents/ScreenReaderOnly.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IAction } from '../../../../../base/common/actions.js';

// Localized strings.
const loadingText = localize('ghostCell.loading', 'Generating suggestion...');
const acceptLabel = localize('ghostCell.accept', 'Accept');
const acceptAndRunLabel = localize('ghostCell.acceptAndRun', 'Accept and Run');
const acceptDropdownTooltip = localize('ghostCell.acceptDropdownTooltip', 'More accept options');
const dismissLabel = localize('ghostCell.dismiss', 'Dismiss');
const dontSuggestAgainLabel = localize('ghostCell.dontSuggestAgain', "Don't suggest again");
const dismissDropdownTooltip = localize('ghostCell.dismissDropdownTooltip', 'More dismiss options');
const regenerateLabel = localize('ghostCell.regenerate', 'Regenerate');
const defaultExplanation = localize('ghostCell.defaultExplanation', 'Suggested next step');
const suggestionAvailableAnnouncement = localize('ghostCell.suggestionAvailable', 'AI suggestion available. Use Accept to insert the suggested code.');
const loadingAnnouncement = localize('ghostCell.loadingAnnouncement', 'Generating AI suggestion for next cell...');

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
	acceptActions: IAction[];
	dismissActions: IAction[];
	contextMenuService: ReturnType<typeof usePositronReactServicesContext>['contextMenuService'];
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
	acceptActions,
	dismissActions,
	contextMenuService
}) => {
	return (
		<>
			<div className='ghost-cell-header'>
				<div className='ghost-cell-header-content'>
					<span className='ghost-cell-icon codicon codicon-sparkle' />
					<span className='ghost-cell-explanation'>
						{explanation || defaultExplanation}
					</span>
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
	acceptActions: IAction[],
	dismissActions: IAction[],
	contextMenuService: ReturnType<typeof usePositronReactServicesContext>['contextMenuService']
): React.ReactNode {
	switch (state.status) {
		case 'hidden':
			return null;

		case 'loading':
			return <GhostCellLoading />;

		case 'streaming':
			return (
				<GhostCellContent
					acceptActions={acceptActions}
					code={state.code}
					contextMenuService={contextMenuService}
					dismissActions={dismissActions}
					explanation={state.explanation}
					isStreaming={true}
					onAcceptAndRun={onAcceptAndRun}
					onDismiss={onDismiss}
					onRegenerate={onRegenerate}
				/>
			);

		case 'ready':
			return (
				<GhostCellContent
					acceptActions={acceptActions}
					code={state.code}
					contextMenuService={contextMenuService}
					dismissActions={dismissActions}
					explanation={state.explanation}
					isStreaming={false}
					onAcceptAndRun={onAcceptAndRun}
					onDismiss={onDismiss}
					onRegenerate={onRegenerate}
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
	const { contextMenuService } = services;
	const ghostCellState = useObservedValue(instance.ghostCellState);
	const [announcement, setAnnouncement] = React.useState('');

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

	const handleDisableGlobally = React.useCallback(() => {
		instance.disableGhostCellSuggestions();
	}, [instance]);

	const handleRegenerate = React.useCallback(() => {
		instance.regenerateGhostCellSuggestion();
	}, [instance]);

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
			id: 'ghost-cell-dont-suggest-again',
			label: dontSuggestAgainLabel,
			tooltip: dontSuggestAgainLabel,
			class: undefined,
			enabled: true,
			run: handleDisableGlobally
		}
	], [handleDismiss, handleDisableGlobally]);

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
			aria-label={localize('ghostCell.ariaLabel', 'AI suggestion for next cell')}
			className={containerClass}
		>
			<div className='ghost-cell-container'>
				{renderGhostCellState(
					ghostCellState,
					handleAcceptAndRun,
					handleDismiss,
					handleRegenerate,
					acceptActions,
					dismissActions,
					contextMenuService
				)}
			</div>
			<ScreenReaderOnly className='ghost-cell-announcements'>
				{announcement}
			</ScreenReaderOnly>
		</div>
	);
};
