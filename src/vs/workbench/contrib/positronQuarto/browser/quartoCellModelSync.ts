/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../common/quartoTypes.js';
import { QUARTO_CELL_SCHEME } from '../common/positronQuartoConfig.js';

/**
 * Builds the URI for a cell's synthetic model. The URI reuses the host
 * document's path (so language servers retain a sense of the file location)
 * under the {@link QUARTO_CELL_SCHEME} scheme, with the cell's index in the
 * query so each cell gets a stable, distinct URI.
 */
export function createQuartoCellUri(documentUri: URI, cellIndex: number): URI {
	return documentUri.with({ scheme: QUARTO_CELL_SCHEME, query: `cell=${cellIndex}` });
}

/**
 * Maintains one synthetic {@link ITextModel} per code cell of a single Quarto
 * document, keeping each model's content in sync with its chunk.
 *
 * The synthetic models are created via {@link IModelService} (not as simple
 * widgets), so they are mirrored to the extension host as open documents. The
 * per-language servers (Python, R) therefore see the cell content and can
 * answer language-feature requests forwarded by the Quarto completion provider.
 *
 * Cell models are keyed by the cell's stable {@link QuartoCodeCell.index},
 * NOT its `id` (which embeds a content hash that changes on every edit). Keying
 * by index keeps the model identity stable across edits, so the language server
 * sees `didChange` rather than a churn of `didClose`/`didOpen` that would
 * discard its per-document state.
 */
export class QuartoCellModelSync extends Disposable {

	/** Synthetic cell models, keyed by {@link QuartoCodeCell.index}. */
	private readonly _cellModels = new Map<number, ITextModel>();

	constructor(
		private readonly _documentModel: IQuartoDocumentModel,
		private readonly _modelService: IModelService,
		private readonly _languageService: ILanguageService,
	) {
		super();

		this._sync();

		// onDidParse fires on every reparse, even when cells only move, so it is
		// the right signal for refreshing content and line-derived state.
		this._register(this._documentModel.onDidParse(() => this._sync()));

		this._register(toDisposable(() => {
			for (const model of this._cellModels.values()) {
				this._modelService.destroyModel(model.uri);
			}
			this._cellModels.clear();
		}));
	}

	/**
	 * The synthetic model backing the given cell, or `undefined` if the cell is
	 * not currently tracked.
	 */
	getCellModel(cell: QuartoCodeCell): ITextModel | undefined {
		return this._cellModels.get(cell.index);
	}

	private _sync(): void {
		const cells = this._documentModel.cells;

		// Drop models for cell indices that no longer exist.
		for (const [index, model] of this._cellModels) {
			if (index >= cells.length) {
				this._modelService.destroyModel(model.uri);
				this._cellModels.delete(index);
			}
		}

		for (const cell of cells) {
			const code = this._documentModel.getCellCode(cell);
			let model = this._cellModels.get(cell.index);

			// A cell at the same index whose language changed must be recreated so
			// the correct language server picks it up.
			if (model && model.getLanguageId() !== cell.language) {
				this._modelService.destroyModel(model.uri);
				this._cellModels.delete(cell.index);
				model = undefined;
			}

			if (!model) {
				const uri = createQuartoCellUri(this._documentModel.uri, cell.index);
				model = this._modelService.createModel(
					code,
					this._languageService.createById(cell.language),
					uri,
					false /* isForSimpleWidget: must be false so the model syncs to the ext host */,
				);
				this._cellModels.set(cell.index, model);
			} else if (model.getValue() !== code) {
				model.setValue(code);
			}
		}
	}
}
