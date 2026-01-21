/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IQuartoKernelManager, QuartoKernelState } from './quartoKernelManager.js';
import { POSITRON_QUARTO_INLINE_OUTPUT_KEY } from '../common/positronQuartoConfig.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * A status bar entry that displays the Quarto kernel state for the active document.
 */
export class QuartoStatusBarIndicator extends Disposable {
	/** The ID of the status bar entry. */
	public static readonly ID = 'status.quartoKernel';

	/** The name of the status bar entry. */
	public static readonly NAME = localize('status.quartoKernel.name', 'Quarto Kernel');

	/** Accessor for the status bar entry. */
	private readonly _entry: IStatusbarEntryAccessor;

	/** The currently tracked document URI */
	private _currentDocumentUri: URI | undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IStatusbarService private readonly _statusbarService: IStatusbarService,
		@IQuartoKernelManager private readonly _quartoKernelManager: IQuartoKernelManager,
	) {
		super();

		// Add the status bar entry (starts hidden)
		this._entry = this._register(this._statusbarService.addEntry({
			ariaLabel: '',
			name: QuartoStatusBarIndicator.NAME,
			text: '',
		}, QuartoStatusBarIndicator.ID, StatusbarAlignment.RIGHT, 100));

		// Update visibility based on configuration
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY)) {
				this._updateVisibility();
			}
		}));

		// Update when active editor changes
		this._register(this._editorService.onDidActiveEditorChange(() => {
			this._onActiveEditorChanged();
		}));

		// Update when kernel state changes
		this._register(this._quartoKernelManager.onDidChangeKernelState(e => {
			if (this._currentDocumentUri && e.documentUri.toString() === this._currentDocumentUri.toString()) {
				this._updateStatusBarEntry(e.newState, e.session?.runtimeMetadata.runtimeName);
			}
		}));

		// Initial update
		this._updateVisibility();
		this._onActiveEditorChanged();
	}

	/**
	 * Handle active editor changes.
	 */
	private _onActiveEditorChanged(): void {
		const uri = this._editorService.activeEditor?.resource;

		// Check if this is a Quarto document
		if (uri && uri.path.endsWith('.qmd')) {
			this._currentDocumentUri = uri;
			const state = this._quartoKernelManager.getKernelState(uri);
			const session = this._quartoKernelManager.getSessionForDocument(uri);
			this._updateStatusBarEntry(state, session?.runtimeMetadata.runtimeName);
			this._updateVisibility();
		} else {
			this._currentDocumentUri = undefined;
			this._statusbarService.updateEntryVisibility(QuartoStatusBarIndicator.ID, false);
		}
	}

	/**
	 * Update the status bar entry based on kernel state.
	 */
	private _updateStatusBarEntry(state: QuartoKernelState, runtimeName?: string): void {
		const { text, icon, tooltip } = this._getStateDisplay(state, runtimeName);

		this._entry.update({
			ariaLabel: tooltip,
			name: QuartoStatusBarIndicator.NAME,
			text: icon ? `$(${icon.id}) ${text}` : text,
			tooltip,
			command: 'positronQuarto.showKernelMenu',
		});
	}

	/**
	 * Get the display properties for a kernel state.
	 */
	private _getStateDisplay(state: QuartoKernelState, runtimeName?: string): {
		text: string;
		icon: ThemeIcon | undefined;
		tooltip: string;
	} {
		switch (state) {
			case QuartoKernelState.None:
				return {
					text: localize('quartoKernel.state.none', 'No Kernel'),
					icon: Codicon.circleSlash,
					tooltip: localize('quartoKernel.state.none.tooltip', 'No kernel started. Execute a cell to start a kernel.'),
				};

			case QuartoKernelState.Starting:
				return {
					text: runtimeName
						? localize('quartoKernel.state.starting.name', 'Starting {0}', runtimeName)
						: localize('quartoKernel.state.starting', 'Starting Kernel'),
					icon: Codicon.sync,
					tooltip: localize('quartoKernel.state.starting.tooltip', 'Kernel is starting...'),
				};

			case QuartoKernelState.Ready:
				return {
					text: runtimeName ?? localize('quartoKernel.state.ready', 'Kernel Ready'),
					icon: Codicon.check,
					tooltip: runtimeName
						? localize('quartoKernel.state.ready.tooltip.name', '{0} kernel is ready', runtimeName)
						: localize('quartoKernel.state.ready.tooltip', 'Kernel is ready'),
				};

			case QuartoKernelState.Busy:
				return {
					text: runtimeName ?? localize('quartoKernel.state.busy', 'Kernel Busy'),
					icon: Codicon.loading,
					tooltip: localize('quartoKernel.state.busy.tooltip', 'Kernel is executing code'),
				};

			case QuartoKernelState.Error:
				return {
					text: localize('quartoKernel.state.error', 'Kernel Error'),
					icon: Codicon.error,
					tooltip: localize('quartoKernel.state.error.tooltip', 'Kernel failed to start. Click to retry.'),
				};

			case QuartoKernelState.ShuttingDown:
				return {
					text: localize('quartoKernel.state.shuttingDown', 'Shutting Down'),
					icon: Codicon.sync,
					tooltip: localize('quartoKernel.state.shuttingDown.tooltip', 'Kernel is shutting down'),
				};

			default:
				return {
					text: localize('quartoKernel.state.unknown', 'Unknown'),
					icon: Codicon.question,
					tooltip: localize('quartoKernel.state.unknown.tooltip', 'Unknown kernel state'),
				};
		}
	}

	/**
	 * Update the visibility of the status bar entry based on configuration and active editor.
	 */
	private _updateVisibility(): void {
		const featureEnabled = this._configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;
		const isQuartoDocument = this._currentDocumentUri !== undefined;

		this._statusbarService.updateEntryVisibility(
			QuartoStatusBarIndicator.ID,
			featureEnabled && isQuartoDocument
		);
	}
}
