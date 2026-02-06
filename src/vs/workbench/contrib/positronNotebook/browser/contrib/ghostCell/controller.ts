/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IObservable, autorun, observableValue } from '../../../../../../base/common/observable.js';
import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { CommandsRegistry, ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../../../platform/notification/common/notification.js';
import { RawContextKey, IContextKey } from '../../../../../../platform/contextkey/common/contextkey.js';
import { localize } from '../../../../../../nls.js';
import { IPositronNotebookContribution } from '../../positronNotebookExtensions.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { INotebookExecutionStateService, NotebookExecutionType } from '../../../../notebook/common/notebookExecutionStateService.js';
import { CellEditType } from '../../../../notebook/common/notebookCommon.js';
import { CellKind as PositronCellKind } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { getAssistantSettings, setAssistantSettings } from '../../../common/notebookAssistantMetadata.js';
import {
	POSITRON_NOTEBOOK_GHOST_CELL_SUGGESTIONS_KEY,
	POSITRON_NOTEBOOK_GHOST_CELL_DELAY_KEY,
	POSITRON_NOTEBOOK_GHOST_CELL_AUTOMATIC_KEY,
} from './config.js';

// ===== Types =====

/**
 * Represents the state of a ghost cell suggestion.
 */
export type GhostCellState =
	| { status: 'hidden' }
	| { status: 'opt-in-prompt'; executedCellIndex: number }
	| { status: 'awaiting-request'; executedCellIndex: number; automatic: boolean }
	| { status: 'loading'; executedCellIndex: number; automatic: boolean }
	| { status: 'streaming'; executedCellIndex: number; code: string; explanation: string; automatic: boolean }
	| { status: 'ready'; executedCellIndex: number; code: string; explanation: string; language: string; automatic: boolean; modelName?: string; usedFallback?: boolean }
	| { status: 'error'; executedCellIndex: number; message: string };

// ===== Context Keys =====

export const POSITRON_NOTEBOOK_GHOST_CELL_AWAITING_REQUEST = new RawContextKey<boolean>(
	'positronNotebookGhostCellAwaitingRequest',
	false,
	localize('positronNotebookGhostCellAwaitingRequest', "Whether a ghost cell is awaiting a suggestion request (pull mode)")
);

// ===== Controller =====

export class GhostCellController extends Disposable implements IPositronNotebookContribution {
	public static readonly ID = 'positron.notebook.contrib.ghostCellController';

	// State
	private readonly _ghostCellState = observableValue<GhostCellState>('ghostCellState', { status: 'hidden' });
	readonly ghostCellState: IObservable<GhostCellState> = this._ghostCellState;

	// Private properties
	private _ghostCellDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	private _ghostCellCancellationToken: CancellationTokenSource | undefined;
	private _ghostCellAwaitingRequestContextKey: IContextKey<boolean> | undefined;
	private _optInDismissedThisOpen: boolean = false;
	private _enabledThisSession: boolean = false;

	constructor(
		private readonly _notebook: IPositronNotebookInstance,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Defer context key binding until attachView() has been called, since
		// scopedContextKeyService is not available during construction.
		// The autorun re-runs when either container or ghostCellState changes,
		// keeping the context key in sync with the state.
		this._register(autorun(reader => {
			const container = this._notebook.container.read(reader);
			if (!container) {
				return;
			}

			if (!this._ghostCellAwaitingRequestContextKey) {
				this._ghostCellAwaitingRequestContextKey =
					POSITRON_NOTEBOOK_GHOST_CELL_AWAITING_REQUEST.bindTo(this._notebook.scopedContextKeyService);
			}

			const state = this._ghostCellState.read(reader);
			this._ghostCellAwaitingRequestContextKey.set(state.status === 'awaiting-request');
		}));

		// Listen for cell execution completion to trigger ghost cell suggestions
		this._register(this._notebookExecutionStateService.onDidChangeExecution((event) => {
			// Only handle cell execution events for this notebook
			if (event.type !== NotebookExecutionType.cell || !event.affectsNotebook(this._notebook.uri)) {
				return;
			}

			// Type narrowing for cell execution events
			const cellEvent = event;
			if (cellEvent.type !== NotebookExecutionType.cell) {
				return;
			}

			// When execution completes (changed is undefined), trigger ghost cell suggestion
			if (cellEvent.changed === undefined) {
				// Find the cell index by handle
				const cells = this._notebook.cells.get();
				const cellIndex = cells.findIndex(c => c.handle === cellEvent.cellHandle);
				if (cellIndex !== -1) {
					const cell = cells[cellIndex];
					// Only trigger for code cells that executed successfully
					if (cell.isCodeCell()) {
						const lastRunSuccess = cell.lastRunSuccess.get();
						if (lastRunSuccess === true) {
							this._scheduleGhostCellSuggestion(cellIndex);
						}
					}
				}
			}
		}));
	}

	public static get(notebook: IPositronNotebookInstance): GhostCellController | undefined {
		return notebook.getContribution<GhostCellController>(GhostCellController.ID);
	}

	// ===== Public API =====

	/**
	 * Get whether automatic mode is enabled for ghost cells.
	 * @returns true for automatic suggestions, false for on-demand
	 */
	isAutomaticMode(): boolean {
		return this._isAutomaticMode();
	}

	/**
	 * Toggle between automatic and on-demand mode.
	 * Updates the global setting and handles state transitions if needed.
	 */
	toggleAutomaticMode(): void {
		const currentAutomatic = this._isAutomaticMode();
		const newAutomatic = !currentAutomatic;

		// Update the global setting (async, but we don't need to wait)
		// Use undefined to remove when setting matches default (true)
		this._configurationService.updateValue(
			POSITRON_NOTEBOOK_GHOST_CELL_AUTOMATIC_KEY,
			newAutomatic ? undefined : false,
			ConfigurationTarget.USER
		);

		// Handle state transition if ghost cell is currently visible with mode toggle
		const currentState = this._ghostCellState.get();
		if (currentState.status === 'awaiting-request') {
			if (newAutomatic) {
				// Switching to automatic mode while awaiting request - trigger the suggestion
				this.triggerGhostCellSuggestion(currentState.executedCellIndex);
			} else {
				// Update state with new mode for immediate UI feedback
				this._ghostCellState.set({ ...currentState, automatic: newAutomatic }, undefined);
			}
		} else if (currentState.status === 'loading') {
			this._ghostCellState.set({ ...currentState, automatic: newAutomatic }, undefined);
		} else if (currentState.status === 'streaming') {
			this._ghostCellState.set({ ...currentState, automatic: newAutomatic }, undefined);
		} else if (currentState.status === 'ready') {
			this._ghostCellState.set({ ...currentState, automatic: newAutomatic }, undefined);
		}
		// For 'hidden', 'opt-in-prompt', and 'error' states, no state update needed
	}

	/**
	 * Trigger generation of a ghost cell suggestion.
	 * @param executedCellIndex The index of the cell that was just executed
	 * @param skipConfigCheck If true, skip the extension-side config check (used when workbench has already verified)
	 */
	triggerGhostCellSuggestion(executedCellIndex: number, skipConfigCheck: boolean = false): void {
		// Cancel any existing request
		if (this._ghostCellCancellationToken) {
			this._ghostCellCancellationToken.cancel();
			this._ghostCellCancellationToken.dispose();
		}

		// Check if enabled
		if (!this._isGhostCellEnabled()) {
			this._ghostCellState.set({ status: 'hidden' }, undefined);
			return;
		}

		// Get current automatic mode for state
		const automatic = this._isAutomaticMode();

		// Set loading state
		this._ghostCellState.set({ status: 'loading', executedCellIndex, automatic }, undefined);

		// Create new cancellation token
		this._ghostCellCancellationToken = new CancellationTokenSource();
		const token = this._ghostCellCancellationToken.token;

		// Register callback command for streaming updates
		const callbackCommandId = `positron-notebook-ghost-cell-callback-${generateUuid()}`;
		const callbackDisposable = CommandsRegistry.registerCommand(
			callbackCommandId,
			(_accessor, partial: { code?: string; explanation?: string }) => {
				if (token.isCancellationRequested) {
					return;
				}
				// Update state to streaming with partial content
				this._ghostCellState.set({
					status: 'streaming',
					executedCellIndex,
					code: partial.code || '',
					explanation: partial.explanation || '',
					automatic
				}, undefined);
			}
		);

		// Execute the command to generate suggestion
		this._commandService.executeCommand(
			'positron-assistant.generateGhostCellSuggestion',
			this._notebook.uri.toString(),
			executedCellIndex,
			callbackCommandId,
			skipConfigCheck,
			token
		).then((result: unknown) => {
			callbackDisposable.dispose();

			if (token.isCancellationRequested) {
				return;
			}

			if (result && typeof result === 'object' && 'code' in result) {
				const suggestion = result as { code: string; explanation: string; language: string; modelName?: string; usedFallback?: boolean };
				this._ghostCellState.set({
					status: 'ready',
					executedCellIndex,
					code: suggestion.code,
					explanation: suggestion.explanation,
					language: suggestion.language,
					automatic,
					modelName: suggestion.modelName,
					usedFallback: suggestion.usedFallback
				}, undefined);
			} else {
				// No suggestion generated, hide ghost cell
				this._ghostCellState.set({ status: 'hidden' }, undefined);
			}
		}).catch((error: unknown) => {
			callbackDisposable.dispose();

			if (token.isCancellationRequested) {
				return;
			}

			this._logService.error(this._notebook.uri.toString(), 'Ghost cell suggestion failed:', error);
			this._ghostCellState.set({
				status: 'error',
				executedCellIndex,
				message: error instanceof Error ? error.message : String(error)
			}, undefined);

			// Auto-dismiss error after 5 seconds
			setTimeout(() => {
				const currentState = this._ghostCellState.get();
				if (currentState.status === 'error') {
					this._ghostCellState.set({ status: 'hidden' }, undefined);
				}
			}, 5000);
		});
	}

	/**
	 * Accept the current ghost cell suggestion by inserting it as a new cell.
	 * @param execute If true, also executes the newly inserted cell
	 */
	acceptGhostCellSuggestion(execute?: boolean): void {
		const state = this._ghostCellState.get();
		if (state.status !== 'ready') {
			return;
		}

		// Hide ghost cell first
		this._ghostCellState.set({ status: 'hidden' }, undefined);

		// Insert the cell at the end of the notebook (where the ghost cell is displayed)
		const insertIndex = this._notebook.cells.get().length;
		this._notebook.addCell(PositronCellKind.Code, insertIndex, false, state.code);

		// Optionally execute the new cell
		if (execute) {
			const cells = this._notebook.cells.get();
			const newCell = cells[insertIndex];
			if (newCell) {
				this._notebook.runCells([newCell]);
			}
		}
	}

	/**
	 * Dismiss the current ghost cell suggestion.
	 * @param disableForNotebook If true, also disables ghost cell suggestions for this notebook
	 */
	dismissGhostCell(disableForNotebook?: boolean): void {
		// Cancel any pending request
		if (this._ghostCellDebounceTimer) {
			clearTimeout(this._ghostCellDebounceTimer);
			this._ghostCellDebounceTimer = undefined;
		}

		if (this._ghostCellCancellationToken) {
			this._ghostCellCancellationToken.cancel();
			this._ghostCellCancellationToken.dispose();
			this._ghostCellCancellationToken = undefined;
		}

		// Hide ghost cell
		this._ghostCellState.set({ status: 'hidden' }, undefined);

		// Optionally disable for this notebook
		if (disableForNotebook) {
			const textModel = this._notebook.textModel;
			if (textModel) {
				const newMetadata = setAssistantSettings({ ...textModel.metadata }, { ghostCellSuggestions: 'disabled' });
				textModel.applyEdits([{
					editType: CellEditType.DocumentMetadata,
					metadata: newMetadata
				}], true, undefined, () => undefined, undefined, true);

				// Show notification with re-enable action
				this._notificationService.prompt(
					Severity.Info,
					localize('ghostCell.disabledForNotebook', "Ghost cell suggestions disabled for this notebook"),
					[{
						label: localize('ghostCell.reenable', "Re-enable"),
						run: () => this.enableGhostCellSuggestionsForNotebook()
					}]
				);
			}
		}
	}

	/**
	 * Regenerate the ghost cell suggestion with a new request.
	 */
	regenerateGhostCellSuggestion(): void {
		const state = this._ghostCellState.get();

		// Get the executed cell index from current state
		let cellIndex: number;
		if (state.status === 'hidden') {
			// Use the last cell as a fallback
			const cells = this._notebook.cells.get();
			cellIndex = cells.length - 1;
			if (cellIndex < 0) {
				return;
			}
		} else {
			cellIndex = state.executedCellIndex;
		}

		// Trigger a new suggestion
		this.triggerGhostCellSuggestion(cellIndex);
	}

	/**
	 * Disable ghost cell suggestions globally.
	 * Updates the user setting to disable suggestions and dismisses the current ghost cell.
	 */
	disableGhostCellSuggestions(): void {
		// Setting enabled to false marks the user's explicit choice
		// Use undefined to remove when setting matches default (false)
		this._configurationService.updateValue(
			POSITRON_NOTEBOOK_GHOST_CELL_SUGGESTIONS_KEY,
			undefined,
			ConfigurationTarget.USER
		);

		// Dismiss the current ghost cell
		this.dismissGhostCell(false);
	}

	/**
	 * Enable ghost cell suggestions globally (opt-in).
	 * Sets enabled to true, then triggers a suggestion.
	 */
	enableGhostCellSuggestions(): void {
		// Set session flag immediately for instant effect
		this._enabledThisSession = true;

		const state = this._ghostCellState.get();
		const executedCellIndex = state.status !== 'hidden' && 'executedCellIndex' in state
			? state.executedCellIndex
			: this._notebook.cells.get().length - 1;

		// Persist to config (fire and forget - matches disableGhostCellSuggestions pattern)
		// Setting enabled to true marks the user's explicit choice
		this._configurationService.updateValue(
			POSITRON_NOTEBOOK_GHOST_CELL_SUGGESTIONS_KEY,
			true,
			ConfigurationTarget.USER
		);

		// Trigger suggestion immediately, skipping config check since we just set the flag
		if (executedCellIndex >= 0) {
			this.triggerGhostCellSuggestion(executedCellIndex, true);
		}
	}

	/**
	 * Enable ghost cell suggestions for this notebook by clearing the per-notebook disable setting.
	 * This clears the 'disabled' metadata from the notebook and triggers a suggestion if globally enabled.
	 */
	enableGhostCellSuggestionsForNotebook(): void {
		const textModel = this._notebook.textModel;
		if (textModel) {
			// Clear the per-notebook disabled setting by setting to undefined
			const newMetadata = setAssistantSettings({ ...textModel.metadata }, { ghostCellSuggestions: undefined });
			textModel.applyEdits([{
				editType: CellEditType.DocumentMetadata,
				metadata: newMetadata
			}], true, undefined, () => undefined, undefined, true);

			// Get the last executed cell index for triggering suggestion
			const state = this._ghostCellState.get();
			const executedCellIndex = state.status !== 'hidden' && 'executedCellIndex' in state
				? state.executedCellIndex
				: this._notebook.cells.get().length - 1;

			// Trigger suggestion if globally enabled and we have a valid cell index
			if (executedCellIndex >= 0) {
				this.triggerGhostCellSuggestion(executedCellIndex);
			}
		}
	}

	/**
	 * Dismiss the opt-in prompt for this notebook open only.
	 * The prompt will appear again the next time the notebook is opened.
	 */
	dismissOptInPrompt(): void {
		this._optInDismissedThisOpen = true;
		this._ghostCellState.set({ status: 'hidden' }, undefined);
	}

	/**
	 * Request a ghost cell suggestion when in pull mode.
	 * Only triggers if the current state is 'awaiting-request'.
	 */
	requestGhostCellSuggestion(): void {
		const state = this._ghostCellState.get();
		if (state.status !== 'awaiting-request') {
			return;
		}
		this.triggerGhostCellSuggestion(state.executedCellIndex);
	}

	// ===== Private Helpers =====

	/**
	 * Check if ghost cell suggestions are enabled for this notebook.
	 */
	private _isGhostCellEnabled(): boolean {
		// Check per-notebook override first
		const settings = getAssistantSettings(this._notebook.textModel?.metadata);
		if (settings.ghostCellSuggestions !== undefined) {
			return settings.ghostCellSuggestions === 'enabled';
		}

		// If user enabled this session, return true immediately
		if (this._enabledThisSession) {
			return true;
		}

		// Check if user has explicitly set the enabled setting using inspect()
		// If userValue is undefined, user hasn't made a choice yet
		const inspected = this._configurationService.inspect<boolean>(POSITRON_NOTEBOOK_GHOST_CELL_SUGGESTIONS_KEY);
		if (inspected?.userValue === undefined) {
			return false;
		}

		// Fall back to global setting
		return this._configurationService.getValue<boolean>(POSITRON_NOTEBOOK_GHOST_CELL_SUGGESTIONS_KEY) ?? false;
	}

	/**
	 * Check if we should show the opt-in prompt for this notebook.
	 * Returns true if: user hasn't explicitly set enabled, no per-notebook override, and not dismissed this open.
	 */
	private _shouldShowOptInPrompt(): boolean {
		// Check per-notebook override first - if set, no prompt needed
		const settings = getAssistantSettings(this._notebook.textModel?.metadata);
		if (settings.ghostCellSuggestions !== undefined) {
			return false;
		}

		// If user enabled this session, don't show prompt
		if (this._enabledThisSession) {
			return false;
		}

		// Check if user has explicitly set the enabled setting using inspect()
		// If userValue is defined, user has made a choice
		const inspected = this._configurationService.inspect<boolean>(POSITRON_NOTEBOOK_GHOST_CELL_SUGGESTIONS_KEY);
		if (inspected?.userValue !== undefined) {
			return false;
		}

		// Check if dismissed this open
		if (this._optInDismissedThisOpen) {
			return false;
		}

		return true;
	}

	/**
	 * Get whether automatic mode is enabled for ghost cells.
	 * Checks per-notebook override first, then global setting.
	 * @returns true for automatic suggestions, false for on-demand
	 */
	private _isAutomaticMode(): boolean {
		const settings = getAssistantSettings(this._notebook.textModel?.metadata);
		if (settings.automatic !== undefined) {
			return settings.automatic;
		}
		return this._configurationService.getValue<boolean>(POSITRON_NOTEBOOK_GHOST_CELL_AUTOMATIC_KEY) ?? true;
	}

	/**
	 * Schedule a ghost cell suggestion with debounce.
	 * @param cellIndex The index of the cell that was just executed
	 */
	private _scheduleGhostCellSuggestion(cellIndex: number): void {
		// Cancel any pending debounce timer
		if (this._ghostCellDebounceTimer) {
			clearTimeout(this._ghostCellDebounceTimer);
			this._ghostCellDebounceTimer = undefined;
		}

		// Cancel any in-flight request
		if (this._ghostCellCancellationToken) {
			this._ghostCellCancellationToken.cancel();
			this._ghostCellCancellationToken.dispose();
			this._ghostCellCancellationToken = undefined;
		}

		// Check if we should show the opt-in prompt
		if (this._shouldShowOptInPrompt()) {
			// Set up debounce using configurable delay
			const delay = this._configurationService.getValue<number>(POSITRON_NOTEBOOK_GHOST_CELL_DELAY_KEY) ?? 2000;
			this._ghostCellDebounceTimer = setTimeout(() => {
				this._ghostCellDebounceTimer = undefined;
				this._ghostCellState.set({ status: 'opt-in-prompt', executedCellIndex: cellIndex }, undefined);
			}, delay);
			return;
		}

		// Check if enabled
		if (!this._isGhostCellEnabled()) {
			this._ghostCellState.set({ status: 'hidden' }, undefined);
			return;
		}

		// Set up debounce using configurable delay
		const delay = this._configurationService.getValue<number>(POSITRON_NOTEBOOK_GHOST_CELL_DELAY_KEY) ?? 2000;
		this._ghostCellDebounceTimer = setTimeout(() => {
			this._ghostCellDebounceTimer = undefined;

			// Check if automatic mode is enabled
			const automatic = this._isAutomaticMode();
			if (!automatic) {
				// For on-demand mode, show awaiting-request state instead of triggering immediately
				this._ghostCellState.set({ status: 'awaiting-request', executedCellIndex: cellIndex, automatic }, undefined);
			} else {
				// For automatic mode, trigger suggestion immediately
				this.triggerGhostCellSuggestion(cellIndex);
			}
		}, delay);
	}
}
