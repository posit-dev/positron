/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IRange, Range } from '../../../../editor/common/core/range.js';
import { ProviderResult } from '../../../../editor/common/languages.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CellUri } from '../../notebook/common/notebookCommon.js';
import { QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY } from '../common/positronQuartoConfig.js';
import { isInsideCellCode, toDocumentRange } from '../common/quartoPositionMapping.js';
import { fenceLanguageToCellLanguage } from '../common/quartoShadowNotebook.js';
import { isShadowCellUri } from '../common/quartoShadowUriLeakGuard.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../common/quartoTypes.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoShadowNotebookService } from './quartoShadowNotebookService.js';

/**
 * A language feature request resolved to a shadow notebook cell: the request
 * position is inside `cell`'s code, and `cellModel` is the materialized text
 * model the underlying providers are invoked with.
 */
export interface QuartoShadowCellRequest {
	/** The Quarto document model owning the cell. */
	readonly documentModel: IQuartoDocumentModel;

	/** The parsed cell whose code region contains the request position. */
	readonly cell: QuartoCodeCell;

	/** The shadow notebook cell's text model. Never edit it (one-way sync). */
	readonly cellModel: ITextModel;
}

/**
 * Shared request-resolution and result-translation logic for the Quarto
 * shadow bridge providers (completion, hover, definition, etc.).
 *
 * Each bridge provider receives a request at a `.qmd` position, uses
 * {@link resolveRequest} to find the shadow cell under it, forwards the
 * request to the providers registered for the cell model (translated to cell
 * coordinates), and translates results back to `.qmd` space. Requests
 * outside cell code resolve to undefined so prose stays with the Quarto
 * extension.
 */
export class QuartoShadowLanguageBridge {

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoShadowNotebookService private readonly _shadowNotebookService: IQuartoShadowNotebookService,
		@ILogService private readonly _logService: ILogService,
	) { }

	/**
	 * Resolve a language feature request at a `.qmd` line to the shadow cell
	 * under it.
	 * @returns The resolved request, or undefined when the shadow notebook
	 * feature is disabled, the document has no shadow, or the line is prose
	 * or a fence line.
	 */
	resolveRequest(model: ITextModel, lineNumber: number): QuartoShadowCellRequest | undefined {
		// The setting is read live: flipping it takes effect on the next
		// request without re-registering providers.
		if (this._configurationService.getValue<boolean>(QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY) === false) {
			return undefined;
		}
		if (!this._documentModelService.hasModel(model.uri)) {
			return undefined;
		}
		const documentModel = this._documentModelService.getModelForUri(model.uri);

		const cell = documentModel.getCellAtLine(lineNumber);
		if (!cell || !isInsideCellCode(cell, lineNumber)) {
			// Prose or a fence line: let the Quarto extension handle it.
			return undefined;
		}

		const notebook = this._shadowNotebookService.getShadowNotebook(model.uri);
		if (!notebook) {
			return undefined;
		}

		// The shadow notebook mirrors the parse's code cells 1:1 in order, so
		// at any instant after a sync the parse cell at index i corresponds to
		// the notebook cell at index i. (Cell identity is never persisted by
		// index across parses; this is a same-instant correspondence.) The
		// language check guards the brief window where a structural edit has
		// reparsed but a request races the sync.
		const notebookCell = notebook.cells[cell.index];
		if (!notebookCell || notebookCell.language !== fenceLanguageToCellLanguage(cell.language)) {
			return undefined;
		}

		const cellModel = this._shadowNotebookService.getCellTextModel(model.uri, notebookCell.handle);
		if (!cellModel) {
			return undefined;
		}

		return { documentModel, cell, cellModel };
	}

	/**
	 * Translate a location-like (URI + range) from provider space back to
	 * user space. Shadow cell URIs are rewritten to their Quarto document's
	 * URI with the range translated to document coordinates; all other URIs
	 * (real files, real notebook cells) pass through untouched.
	 * @returns The translated location, or undefined for a shadow cell URI
	 * that cannot be mapped (dropped, with a log line - never surfaced raw).
	 */
	mapLocationToDocument(uri: URI, range: IRange): { uri: URI; range: Range } | undefined {
		if (!isShadowCellUri(uri)) {
			return { uri, range: Range.lift(range) };
		}
		const parsed = CellUri.parse(uri);
		const cell = parsed && this._getCellForParsedCellUri(parsed.notebook, parsed.handle);
		if (!parsed || !cell) {
			this._logService.warn(`[QuartoShadowBridge] Dropping location at unmappable shadow cell URI ${uri.toString()}`);
			return undefined;
		}
		return { uri: parsed.notebook, range: toDocumentRange(cell, range) };
	}

	/**
	 * Find the parsed Quarto cell corresponding to a shadow cell, across all
	 * documents with live shadows (a result may point at another open
	 * `.qmd`'s cells, e.g. workspace-wide references).
	 */
	private _getCellForParsedCellUri(notebookUri: URI, cellHandle: number): QuartoCodeCell | undefined {
		const notebook = this._shadowNotebookService.getShadowNotebook(notebookUri);
		if (!notebook || !this._documentModelService.hasModel(notebookUri)) {
			return undefined;
		}
		const index = notebook.cells.findIndex(cell => cell.handle === cellHandle);
		if (index < 0) {
			return undefined;
		}
		// Same-instant index correspondence between the shadow notebook's
		// cells and the parse's cells (see resolveRequest).
		return this._documentModelService.getModelForUri(notebookUri).cells[index];
	}
}

/**
 * Invoke one underlying provider, swallowing (and logging) its errors so a
 * single failing provider can't sink the whole bridged request.
 */
export async function invokeSafely<T>(invoke: () => ProviderResult<T>, logService: ILogService): Promise<T | undefined> {
	try {
		return await invoke() ?? undefined;
	} catch (err) {
		logService.warn('[QuartoShadowBridge] Underlying provider failed', err);
		return undefined;
	}
}
