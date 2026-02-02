/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';

/**
 * Editor contribution that notifies users when a Quarto document contains multiple languages.
 *
 * In a multi-language document:
 * - The primary language cells (first language encountered) execute inline with the kernel
 * - Non-primary language cells execute via the console service (output appears in console)
 *
 * This contribution is currently disabled since the new behavior is transparent to users.
 * The code is kept for potential future use if we want to show informational messages.
 */
export class QuartoMultiLanguageWarning extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.quartoMultiLanguageWarning';

	constructor(
		private readonly _editor: ICodeEditor,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		// Multi-language support is now handled transparently:
		// - Primary language cells execute inline via kernel
		// - Non-primary language cells execute via console service
		// No notification is needed since the behavior is intuitive.

		// Keep the unused parameters to maintain the same interface for dependency injection
		void this._editor;
		void this._documentModelService;
		void this._configurationService;
		void this._notificationService;
	}
}
