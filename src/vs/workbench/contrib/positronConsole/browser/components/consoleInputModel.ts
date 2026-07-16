/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { Schemas } from '../../../../../base/common/network.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { DisposableStore, thenRegisterOrDispose } from '../../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';

/**
 * Creates the in-memory text model that backs a console input editor and holds
 * an {@link ITextModelService} reference to it for the model's lifetime.
 *
 * A different URI path prefix is used for notebook console inputs so that the
 * notebook LSP can match them via document selectors, while the console LSP
 * skips them.
 *
 * The console owns this model, but other consumers (e.g. a language server
 * that opens the same document) acquire their own references via the text
 * model service. When the last reference is released, the resolver disposes
 * the underlying model (TextResourceEditorModel.dispose ->
 * modelService.destroyModel). That would pull the model out from under the
 * editor (model.onWillDispose -> CodeEditorWidget.setModel(null)), detach the
 * editor's view, and make the input prompt disappear. Holding our own
 * reference keeps the resolver's reference count above zero for as long as the
 * editor exists, so an external consumer acquiring and later releasing a
 * reference can no longer dispose the model. This mirrors how Positron
 * notebook cells keep their cell models alive (see PositronNotebookCell).
 *
 * @param modelService The model service used to create the model.
 * @param textModelService The text model service used to hold a reference.
 * @param languageService The language service used to resolve the language.
 * @param languageId The language id of the console's runtime.
 * @param isNotebook Whether the console input belongs to a notebook session.
 * @param store The disposable store the held model reference is registered to.
 * @returns The created text model.
 */
export function createConsoleInputModel(
	modelService: IModelService,
	textModelService: ITextModelService,
	languageService: ILanguageService,
	languageId: string,
	isNotebook: boolean,
	store: DisposableStore
): ITextModel {
	const replPrefix = isNotebook ? 'notebook-repl' : 'repl';
	const model = modelService.createModel(
		'',
		languageService.createById(languageId),
		URI.from({
			scheme: Schemas.inMemory,
			path: `/${replPrefix}-${languageId}-${generateUuid()}`
		}),
		false
	);

	// Hold a reference for the model's lifetime so it cannot be disposed out from
	// under the editor (see the doc comment above and issue #13925).
	thenRegisterOrDispose(textModelService.createModelReference(model.uri), store);

	return model;
}
