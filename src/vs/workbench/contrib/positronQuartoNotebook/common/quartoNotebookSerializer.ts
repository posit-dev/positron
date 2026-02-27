/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService, IWriteFileOptions, IFileStatWithMetadata } from '../../../../platform/files/common/files.js';
import { ITextQuery } from '../../../services/search/common/search.js';
import { TransientOptions, NotebookData } from '../../notebook/common/notebookCommon.js';
import { INotebookSerializer, INotebookService } from '../../notebook/common/notebookService.js';
import { NotebookPriorityInfo } from '../../search/common/search.js';
import { INotebookFileMatchNoModel } from '../../search/common/searchNotebookHelpers.js';
import { qmdToNotebook } from './qmdToNotebook.js';
import { notebookToQmd } from './notebookToQmd.js';

/**
 * Notebook serializer for Quarto (.qmd) files.
 */
export class QuartoNotebookSerializer implements INotebookSerializer {
	readonly options: TransientOptions = {
		transientOutputs: true,
		transientCellMetadata: {
			breakpointMargin: true,
			id: true,
		},
		transientDocumentMetadata: {},
		cellContentMetadata: {},
	};

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@INotebookService private readonly _notebookService: INotebookService
	) { }

	async dataToNotebook(data: VSBuffer): Promise<NotebookData> {
		const content = data.toString();
		return qmdToNotebook(content);
	}

	async notebookToData(data: NotebookData): Promise<VSBuffer> {
		const qmd = notebookToQmd(data);
		return VSBuffer.fromString(qmd);
	}

	async save(uri: URI, versionId: number, options: IWriteFileOptions, token: CancellationToken): Promise<IFileStatWithMetadata> {
		// Get the notebook text model to access its current data
		const model = this._notebookService.getNotebookTextModel(uri);
		if (!model) {
			throw new Error(`No notebook model found for ${uri.toString()}`);
		}

		// Build NotebookData from the model
		const data: NotebookData = {
			cells: model.cells.map(cell => ({
				source: cell.getValue(),
				language: cell.language,
				cellKind: cell.cellKind,
				mime: cell.mime,
				outputs: cell.outputs.map(o => ({
					outputId: o.outputId,
					outputs: o.outputs.map(item => ({
						mime: item.mime,
						data: item.data,
					})),
				})),
				metadata: cell.metadata,
			})),
			metadata: model.metadata,
		};

		// Serialize to QMD
		const buffer = await this.notebookToData(data);

		// Write to file system
		await this._fileService.writeFile(uri, buffer, options);

		// Return file stats
		const stat = await this._fileService.resolve(uri);
		return stat as IFileStatWithMetadata;
	}

	async searchInNotebooks(
		_textQuery: ITextQuery,
		_token: CancellationToken,
		_allPriorityInfo: Map<string, NotebookPriorityInfo[]>
	): Promise<{ results: INotebookFileMatchNoModel<URI>[]; limitHit: boolean }> {
		return { results: [], limitHit: false };
	}
}
