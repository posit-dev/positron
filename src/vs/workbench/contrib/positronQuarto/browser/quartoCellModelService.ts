/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../common/quartoTypes.js';
import { QuartoCellModelSync } from './quartoCellModelSync.js';

export const IQuartoCellModelService = createDecorator<IQuartoCellModelService>('quartoCellModelService');

/**
 * Service that owns the synthetic per-cell text models for open Quarto
 * documents. One {@link QuartoCellModelSync} is maintained per document URI.
 */
export interface IQuartoCellModelService {
	readonly _serviceBrand: undefined;

	/**
	 * Ensure a cell-model sync exists for the given document model. Idempotent:
	 * calling it again for the same document is a no-op.
	 */
	ensureSync(documentModel: IQuartoDocumentModel): void;

	/**
	 * Get the synthetic model backing a cell, or `undefined` if no sync exists
	 * for the document or the cell is not tracked.
	 */
	getCellModel(documentUri: URI, cell: QuartoCodeCell): ITextModel | undefined;

	/**
	 * Dispose the sync (and its cell models) for a document URI. Typically called
	 * when the document's editor is closed.
	 */
	disposeSync(documentUri: URI): void;
}

export class QuartoCellModelService extends Disposable implements IQuartoCellModelService {
	declare readonly _serviceBrand: undefined;

	private readonly _syncs = this._register(new DisposableMap<string, QuartoCellModelSync>());

	constructor(
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,
	) {
		super();
	}

	ensureSync(documentModel: IQuartoDocumentModel): void {
		const key = documentModel.uri.toString();
		if (!this._syncs.has(key)) {
			this._syncs.set(key, new QuartoCellModelSync(documentModel, this._modelService, this._languageService));
		}
	}

	getCellModel(documentUri: URI, cell: QuartoCodeCell): ITextModel | undefined {
		return this._syncs.get(documentUri.toString())?.getCellModel(cell);
	}

	disposeSync(documentUri: URI): void {
		this._syncs.deleteAndDispose(documentUri.toString());
	}
}
