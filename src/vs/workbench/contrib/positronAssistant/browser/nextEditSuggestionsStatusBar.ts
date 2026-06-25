/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableWindowInterval } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { getCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IInlineCompletionsService } from '../../../../editor/browser/services/inlineCompletionsService.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, ShowTooltipCommand, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { isNextEditSuggestionsEnabled, NES_CONTEXT_ACTIVE, NES_CONTEXT_BUSY, NES_CONTEXT_ENABLED, NES_ENABLE_SETTING, NextEditSuggestionsStatusDashboard } from './nextEditSuggestionsDashboard.js';

/**
 * Status bar item for the Next Edit Suggestions extension. Shown whenever the
 * `nextEditSuggestions.enabled` context key is true.
 */
export class NextEditSuggestionsStatusBarEntry extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positronNextEditSuggestionsStatusBarEntry';

	private entry: IStatusbarEntryAccessor | undefined = undefined;

	private readonly activeCodeEditorListener = this._register(new MutableDisposable());

	private readonly watchedContextKeys = new Set([NES_CONTEXT_ENABLED, NES_CONTEXT_ACTIVE, NES_CONTEXT_BUSY]);

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInlineCompletionsService private readonly completionsService: IInlineCompletionsService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();

		this.update();
		this.registerListeners();
	}

	private isItemEnabled(): boolean {
		return this.contextKeyService.getContextKeyValue<boolean>(NES_CONTEXT_ENABLED) ?? false;
	}

	private update(): void {
		if (this.isItemEnabled()) {
			const props = this.getEntryProps();
			if (this.entry) {
				this.entry.update(props);
			} else {
				this.entry = this.statusbarService.addEntry(props, 'positron.nextEditSuggestions.statusBarEntry', StatusbarAlignment.RIGHT, { location: { id: 'status.editor.mode', priority: 100.1 }, alignment: StatusbarAlignment.RIGHT });
			}
		} else {
			this.entry?.dispose();
			this.entry = undefined;
		}
	}

	private registerListeners(): void {
		this._register(this.completionsService.onDidChangeIsSnoozing(() => this.update()));
		this._register(this.editorService.onDidActiveEditorChange(() => this.onDidActiveEditorChange()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(NES_ENABLE_SETTING)) {
				this.update();
			}
		}));
		this._register(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(this.watchedContextKeys)) {
				this.update();
			}
		}));
	}

	private onDidActiveEditorChange(): void {
		this.update();

		this.activeCodeEditorListener.clear();

		const activeCodeEditor = getCodeEditor(this.editorService.activeTextEditorControl);
		if (activeCodeEditor) {
			this.activeCodeEditorListener.value = activeCodeEditor.onDidChangeModelLanguage(() => this.update());
		}
	}

	private getEntryProps(): IStatusbarEntry {
		let text: string;
		let ariaLabel: string;

		const languageId = this.editorService.activeTextEditorLanguageId;
		const busy = this.contextKeyService.getContextKeyValue<boolean>(NES_CONTEXT_BUSY) ?? false;
		if (this.completionsService.isSnoozing()) {
			text = '$(bell-slash)';
			ariaLabel = localize('positron.nes.statusSnoozed', "Next edit suggestions snoozed");
		} else if (busy) {
			text = '$(loading~spin)';
			ariaLabel = localize('positron.nes.statusWaiting', "Waiting for next edit suggestion");
		} else if (languageId && !isNextEditSuggestionsEnabled(this.configurationService, languageId)) {
			text = '$(circle-slash)';
			ariaLabel = localize('positron.nes.statusDisabled', "Next edit suggestions disabled");
		} else {
			text = '$(edit-sparkle)';
			ariaLabel = localize('positron.nes.statusName', "Next Edit Suggestions");
		}

		return {
			name: localize('positron.nes.statusName', "Next Edit Suggestions"),
			text,
			ariaLabel,
			command: ShowTooltipCommand,
			showInAllWindows: true,
			tooltip: {
				element: (token: CancellationToken) => {
					const store = new DisposableStore();
					store.add(token.onCancellationRequested(() => store.dispose()));

					const elem = NextEditSuggestionsStatusDashboard.instantiateInContents(this.instantiationService, store);

					// Workaround: dispose once the tooltip leaves the DOM.
					store.add(disposableWindowInterval(mainWindow, () => {
						if (!elem.isConnected) {
							store.dispose();
						}
					}, 2000));

					return elem;
				}
			}
		} satisfies IStatusbarEntry;
	}

	override dispose(): void {
		super.dispose();

		this.entry?.dispose();
		this.entry = undefined;
	}
}
