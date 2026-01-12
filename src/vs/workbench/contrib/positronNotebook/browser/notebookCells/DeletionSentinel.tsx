/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './DeletionSentinel.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IDeletionSentinel } from '../IPositronNotebookInstance.js';
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { POSITRON_NOTEBOOK_DELETION_SENTINEL_TIMEOUT_KEY, POSITRON_NOTEBOOK_SHOW_DELETION_SENTINELS_KEY } from '../positronNotebookExperimentalConfig.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';

interface DeletionSentinelProps {
	sentinel: IDeletionSentinel;
	configurationService: IConfigurationService;
}

/**
 * Configuration quick pick item with an action identifier
 */
interface ConfigQuickPickItem extends IQuickPickItem {
	action: 'toggle' | 'adjust-timeout' | 'disable-auto-close' | 'enable-auto-close';
}

export const DeletionSentinel: React.FC<DeletionSentinelProps> = ({
	sentinel,
	configurationService
}) => {
	const instance = useNotebookInstance();
	const services = usePositronReactServicesContext();
	const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
	const [isPaused, setIsPaused] = React.useState(false);

	// Get configuration values
	const timeout = configurationService.getValue<number>(POSITRON_NOTEBOOK_DELETION_SENTINEL_TIMEOUT_KEY) ?? 10000;
	const showSentinels = configurationService.getValue<boolean>(POSITRON_NOTEBOOK_SHOW_DELETION_SENTINELS_KEY) ?? true;

	// Pause timer on hover for better UX
	const handleMouseEnter = React.useCallback(() => {
		setIsPaused(true);
	}, []);

	const handleMouseLeave = React.useCallback(() => {
		setIsPaused(false);
	}, []);

	const handleRestore = React.useCallback(() => {
		// Clear auto-dismiss timeout
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}

		// Restore the cell (this also removes the sentinel)
		instance.restoreCell(sentinel);
	}, [instance, sentinel]);

	const handleDismiss = React.useCallback(() => {
		instance.removeDeletionSentinel(sentinel.id);
	}, [instance, sentinel.id]);

	/**
	 * Show timeout input dialog to adjust auto-close timeout
	 */
	const showTimeoutInput = React.useCallback(() => {
		const inputBox = services.quickInputService.createInputBox();
		inputBox.title = localize('notebook.setAutoCloseTimeout', 'Set Auto-Close Timeout');
		inputBox.placeholder = localize('notebook.timeoutPlaceholder', 'Enter timeout in seconds (1-60, or 0 to disable)');
		inputBox.value = String(timeout / 1000);
		inputBox.validationMessage = undefined;

		inputBox.onDidChangeValue(value => {
			const num = parseFloat(value);
			if (isNaN(num) || num < 0 || num > 60) {
				inputBox.validationMessage = localize('notebook.invalidTimeout', 'Please enter a number between 0 and 60');
			} else {
				inputBox.validationMessage = undefined;
			}
		});

		inputBox.onDidAccept(() => {
			const num = parseFloat(inputBox.value);
			if (!isNaN(num) && num >= 0 && num <= 60) {
				configurationService.updateValue(
					POSITRON_NOTEBOOK_DELETION_SENTINEL_TIMEOUT_KEY,
					num * 1000,
					ConfigurationTarget.USER
				);
			}
			inputBox.dispose();
		});

		inputBox.onDidHide(() => {
			inputBox.dispose();
		});

		inputBox.show();
	}, [services.quickInputService, timeout, configurationService]);

	/**
	 * Show configuration quick pick menu
	 */
	const handleConfigClick = React.useCallback((e: React.MouseEvent) => {
		e.stopPropagation();

		const quickPick = services.quickInputService.createQuickPick<ConfigQuickPickItem>();
		quickPick.title = localize('notebook.sentinelSettings', 'Deletion Sentinel Settings');

		const items: ConfigQuickPickItem[] = [
			{
				label: showSentinels
					? localize('notebook.hideSentinels', 'Hide deletion sentinels')
					: localize('notebook.showSentinels', 'Show deletion sentinels'),
				description: showSentinels
					? localize('notebook.hideSentinelsDesc', 'Cells will be deleted immediately')
					: localize('notebook.showSentinelsDesc', 'Show undo placeholders when deleting cells'),
				action: 'toggle'
			},
			{
				label: localize('notebook.adjustTimeout', 'Adjust auto-close timeout...'),
				description: localize('notebook.currentTimeout', 'Currently: {0} seconds', Math.round(timeout / 1000)),
				action: 'adjust-timeout'
			},
			// Reactive: show enable/disable based on current state
			timeout > 0
				? {
					label: localize('notebook.disableAutoClose', 'Disable auto-close'),
					description: localize('notebook.keepSentinelsVisible', 'Sentinels remain until manually dismissed'),
					action: 'disable-auto-close' as const
				}
				: {
					label: localize('notebook.enableAutoClose', 'Enable auto-close'),
					description: localize('notebook.enableAutoCloseDesc', 'Sentinels auto-dismiss after timeout'),
					action: 'enable-auto-close' as const
				}
		];

		quickPick.items = items;
		quickPick.canSelectMany = false;

		quickPick.onDidAccept(() => {
			const selection = quickPick.selectedItems[0];
			if (selection) {
				switch (selection.action) {
					case 'toggle':
						configurationService.updateValue(
							POSITRON_NOTEBOOK_SHOW_DELETION_SENTINELS_KEY,
							!showSentinels,
							ConfigurationTarget.USER
						);
						break;
					case 'adjust-timeout':
						showTimeoutInput();
						break;
					case 'disable-auto-close':
						configurationService.updateValue(
							POSITRON_NOTEBOOK_DELETION_SENTINEL_TIMEOUT_KEY,
							0,
							ConfigurationTarget.USER
						);
						break;
					case 'enable-auto-close':
						configurationService.updateValue(
							POSITRON_NOTEBOOK_DELETION_SENTINEL_TIMEOUT_KEY,
							10000, // Default 10 seconds
							ConfigurationTarget.USER
						);
						break;
				}
			}
			quickPick.dispose();
		});

		quickPick.onDidHide(() => {
			quickPick.dispose();
		});

		quickPick.show();
	}, [services.quickInputService, showSentinels, timeout, configurationService, showTimeoutInput]);

	React.useEffect(() => {
		// Skip auto-dismiss if sentinels are hidden, paused, or timeout is disabled
		if (!showSentinels || isPaused || timeout <= 0) {
			return;
		}

		timeoutRef.current = setTimeout(() => {
			instance.removeDeletionSentinel(sentinel.id);
		}, timeout);

		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, [sentinel.id, instance, timeout, isPaused, showSentinels]);

	// Don't render if sentinels are disabled
	if (!showSentinels) {
		return null;
	}

	const cellType = sentinel.cellKind === CellKind.Code
		? localize('notebook.codeCell', 'Code cell')
		: localize('notebook.markdownCell', 'Markdown cell');

	// Calculate truncation info from full cell content
	const totalLines = sentinel.cellData.source.split('\n').length;
	const previewLines = 3;
	const isTruncated = totalLines > previewLines;
	const hiddenLines = totalLines - previewLines;

	return (
		<div
			className='deletion-sentinel positron-notebook-cell'
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			<div className='deletion-sentinel-flash' />
			<div className='deletion-sentinel-content'>
				{/* Main cell content */}
				<div
					className='deletion-sentinel-cell-container'
					data-has-timeout={timeout > 0}
					data-is-paused={isPaused}
					style={{
						'--_countdown-duration': `${timeout}ms`
					} as React.CSSProperties}
				>
					{/* Header with cell info and actions */}
					<div className='deletion-sentinel-header'>
						<span className='deletion-sentinel-message'>
							{localize('notebook.cellDeleted', '{0} deleted', cellType)}
						</span>
						<div className='deletion-sentinel-actions'>
							<ActionButton
								ariaLabel={localize('notebook.restore', 'Restore')}
								className='deletion-sentinel-restore'
								onPressed={handleRestore}
							>
								{localize('notebook.restore', 'Restore')}
							</ActionButton>
							<ActionButton
								ariaLabel={localize('notebook.dismiss', 'Dismiss')}
								className='deletion-sentinel-dismiss'
								onPressed={handleDismiss}
							>
								{localize('notebook.dismiss', 'Dismiss')}
							</ActionButton>
							<button
								aria-label={localize('notebook.configureAutoClose', 'Configure auto-close')}
								className='deletion-sentinel-config-button codicon codicon-settings-gear'
								title={localize('notebook.configureAutoClose', 'Configure auto-close')}
								onClick={handleConfigClick}
							/>
						</div>
					</div>

					{/* Code preview - displayed as plain greyed-out text */}
					<div className='deletion-sentinel-code-preview'>
						{sentinel.previewContent ? (
							<pre className='deletion-sentinel-code-text'>
								{sentinel.previewContent}
							</pre>
						) : (
							<div className='empty-cell-placeholder'>
								{localize('notebook.emptyCell', '(empty cell)')}
							</div>
						)}
					</div>

					{/* Truncation indicator for longer cells */}
					{isTruncated && (
						<div className='deletion-sentinel-truncation-indicator'>
							<span className='truncation-line' />
							<span className='truncation-text'>
								{localize('notebook.moreLines', '+{0} more lines', hiddenLines)}
							</span>
							<span className='truncation-line' />
						</div>
					)}

				</div>
			</div>
		</div>
	);
};
