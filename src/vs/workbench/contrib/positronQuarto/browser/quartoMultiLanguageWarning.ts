/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { POSITRON_QUARTO_INLINE_OUTPUT_KEY, isQuartoDocument } from '../common/positronQuartoConfig.js';

/**
 * Editor contribution that warns users when a Quarto document contains multiple languages.
 * Since Quarto inline output only starts one kernel per document, cells in other languages
 * cannot be executed.
 */
export class QuartoMultiLanguageWarning extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.quartoMultiLanguageWarning';

	private readonly _documentUri: URI | undefined;
	private _warningShown = false;

	constructor(
		private readonly _editor: ICodeEditor,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		const model = this._editor.getModel();
		this._documentUri = model?.uri;

		// Only activate for .qmd files when feature is enabled
		const enabled = this._configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;
		if (!enabled || !this._isQuartoDocument()) {
			return;
		}

		// Check for multi-language on initialization
		this._checkForMultiLanguage();

		// Re-check when document changes
		this._register(this._editor.onDidChangeModelContent(() => {
			this._checkForMultiLanguage();
		}));

		// Listen for configuration changes
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY)) {
				const nowEnabled = this._configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;
				if (nowEnabled) {
					this._checkForMultiLanguage();
				}
			}
		}));
	}

	private _isQuartoDocument(): boolean {
		const model = this._editor.getModel();
		return isQuartoDocument(this._documentUri?.path, model?.getLanguageId());
	}

	private _checkForMultiLanguage(): void {
		// Don't show warning more than once per editor
		if (this._warningShown) {
			return;
		}

		const model = this._editor.getModel();
		if (!model || !this._documentUri) {
			return;
		}

		const quartoModel = this._documentModelService.getModel(model);
		const cells = quartoModel.cells;

		if (cells.length === 0) {
			return;
		}

		// Collect all unique languages in the document
		const languages = new Set<string>();
		for (const cell of cells) {
			languages.add(cell.language.toLowerCase());
		}

		// If there's more than one language, show warning
		if (languages.size > 1) {
			const primaryLanguage = quartoModel.primaryLanguage || cells[0].language;
			const otherLanguages = [...languages].filter(l => l !== primaryLanguage.toLowerCase());

			this._warningShown = true;
			this._notificationService.notify({
				severity: Severity.Warning,
				message: localize(
					'quartoMultiLanguage.warning',
					"This Quarto document contains code cells in multiple languages ({0}). Only {1} cells can be executed inline. Cells in {2} will not produce inline output.",
					[...languages].join(', '),
					primaryLanguage,
					otherLanguages.join(', ')
				),
				sticky: false,
			});
		}
	}
}
