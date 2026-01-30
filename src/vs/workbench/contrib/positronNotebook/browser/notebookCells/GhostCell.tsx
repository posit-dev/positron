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
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { GhostCellState } from '../IPositronNotebookInstance.js';
import { KeyboardModifiers } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { ScreenReaderOnly } from '../../../../../base/browser/ui/positronComponents/ScreenReaderOnly.js';

// Localized strings.
const loadingText = localize('ghostCell.loading', 'Generating suggestion...');
const acceptLabel = localize('ghostCell.accept', 'Accept');
const dismissLabel = localize('ghostCell.dismiss', 'Dismiss');
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
	onAccept: () => void;
	onAcceptAndRun: () => void;
	onDismiss: () => void;
	onRegenerate: () => void;
}

/**
 * GhostCellContent component - displays the suggestion content with actions
 */
const GhostCellContent: React.FC<GhostCellContentProps> = ({
	code,
	explanation,
	isStreaming,
	onAccept,
	onAcceptAndRun,
	onDismiss,
	onRegenerate
}) => {
	const handleAcceptClick = React.useCallback((e: KeyboardModifiers) => {
		if (e.shiftKey) {
			onAcceptAndRun();
		} else {
			onAccept();
		}
	}, [onAccept, onAcceptAndRun]);

	const handleDismissClick = React.useCallback((_e: KeyboardModifiers) => {
		// Shift+click to disable for notebook (future enhancement)
		onDismiss();
	}, [onDismiss]);

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
					<ActionButton
						ariaLabel={acceptLabel}
						className='ghost-cell-accept'
						disabled={isStreaming}
						onPressed={handleAcceptClick}
					>
						{acceptLabel}
					</ActionButton>
					<ActionButton
						ariaLabel={dismissLabel}
						className='ghost-cell-dismiss'
						onPressed={handleDismissClick}
					>
						{dismissLabel}
					</ActionButton>
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
	onAccept: () => void,
	onAcceptAndRun: () => void,
	onDismiss: () => void,
	onRegenerate: () => void
): React.ReactNode {
	switch (state.status) {
		case 'hidden':
			return null;

		case 'loading':
			return <GhostCellLoading />;

		case 'streaming':
			return (
				<GhostCellContent
					code={state.code}
					explanation={state.explanation}
					isStreaming={true}
					onAccept={onAccept}
					onAcceptAndRun={onAcceptAndRun}
					onDismiss={onDismiss}
					onRegenerate={onRegenerate}
				/>
			);

		case 'ready':
			return (
				<GhostCellContent
					code={state.code}
					explanation={state.explanation}
					isStreaming={false}
					onAccept={onAccept}
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

	const handleRegenerate = React.useCallback(() => {
		instance.regenerateGhostCellSuggestion();
	}, [instance]);

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
					handleAccept,
					handleAcceptAndRun,
					handleDismiss,
					handleRegenerate
				)}
			</div>
			<ScreenReaderOnly className='ghost-cell-announcements'>
				{announcement}
			</ScreenReaderOnly>
		</div>
	);
};
