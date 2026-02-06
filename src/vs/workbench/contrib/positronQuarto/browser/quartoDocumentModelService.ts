/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { QuartoDocumentModel } from './quartoDocumentModel.js';
import { IQuartoDocumentModel } from '../common/quartoTypes.js';

export const IQuartoDocumentModelService = createDecorator<IQuartoDocumentModelService>('quartoDocumentModelService');

/**
 * Service for managing Quarto document models.
 * Provides a singleton service to get or create document models for Quarto files.
 */
export interface IQuartoDocumentModelService {
	readonly _serviceBrand: undefined;

	/**
	 * Get or create a document model for a text model.
	 * The model is cached and reused for subsequent calls with the same text model.
	 */
	getModel(textModel: ITextModel): IQuartoDocumentModel;

	/**
	 * Check if a model exists for a URI.
	 */
	hasModel(uri: URI): boolean;

	/**
	 * Return the document model for a URI.
	 */
	getModelForUri(uri: URI): IQuartoDocumentModel;

	/**
	 * Dispose model for a URI.
	 * This is typically called when the editor for the document is closed.
	 */
	disposeModel(uri: URI): void;
}

/**
 * Implementation of the Quarto document model service.
 */
export class QuartoDocumentModelService extends Disposable implements IQuartoDocumentModelService {
	declare readonly _serviceBrand: undefined;

	private readonly _models = this._register(new DisposableMap<string, QuartoDocumentModel>());

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	getModel(textModel: ITextModel): IQuartoDocumentModel {
		const key = textModel.uri.toString();

		let model = this._models.get(key);
		if (!model) {
			this._logService.debug(`[QuartoDocumentModelService] Creating model for ${key}`);
			model = new QuartoDocumentModel(textModel, this._logService);
			this._models.set(key, model);

			// Listen for model disposal to clean up
			textModel.onWillDispose(() => {
				this._logService.debug(`[QuartoDocumentModelService] Text model disposed, cleaning up ${key}`);
				this._models.deleteAndDispose(key);
			});
		}

		return model;
	}

	hasModel(uri: URI): boolean {
		return this._models.has(uri.toString());
	}

	getModelForUri(uri: URI): IQuartoDocumentModel {
		const model = this._models.get(uri.toString());
		if (!model) {
			throw new Error(`No Quarto document model exists for ${uri.toString()}`)
		}
		return model;
	}

	disposeModel(uri: URI): void {
		const key = uri.toString();
		if (this._models.has(key)) {
			this._logService.debug(`[QuartoDocumentModelService] Disposing model for ${key}`);
			this._models.deleteAndDispose(key);
		}
	}
}
