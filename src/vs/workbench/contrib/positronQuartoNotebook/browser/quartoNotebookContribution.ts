/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IFileService, IFileStatWithMetadata, IWriteFileOptions } from '../../../../platform/files/common/files.js';
import { INotebookService, INotebookSerializer } from '../../notebook/common/notebookService.js';
import { NotebookData, TransientOptions } from '../../notebook/common/notebookCommon.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ITextQuery } from '../../../services/search/common/search.js';
import { NotebookPriorityInfo } from '../../search/common/search.js';
import { INotebookFileMatchNoModel } from '../../search/common/searchNotebookHelpers.js';
import { RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { parseQmdToNotebookCells } from '../common/quartoNotebookParser.js';
import { serializeNotebookCells } from '../common/quartoNotebookSerializer.js';
import { QMD_VIEW_TYPE } from '../common/quartoNotebookConstants.js';

/**
 * Internal notebook serializer for Quarto (.qmd) files.
 * Converts between QMD text format and VS Code's notebook data model.
 */
class QuartoNotebookSerializer implements INotebookSerializer {
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
		private readonly _notebookService: INotebookService,
		private readonly _fileService: IFileService,
	) { }

	async dataToNotebook(data: VSBuffer): Promise<NotebookData> {
		const content = data.toString();
		return {
			cells: parseQmdToNotebookCells(content),
			metadata: {},
		};
	}

	async notebookToData(data: NotebookData): Promise<VSBuffer> {
		const qmd = serializeNotebookCells(data.cells);
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
		_allPriorityInfo: Map<string, NotebookPriorityInfo[]>,
	): Promise<{ results: INotebookFileMatchNoModel<URI>[]; limitHit: boolean }> {
		return { results: [], limitHit: false };
	}
}

/**
 * Workbench contribution that registers the Quarto notebook type and serializer.
 */
class QuartoNotebookContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.quartoNotebook';

	constructor(
		@INotebookService private readonly notebookService: INotebookService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();

		// Register the notebook type (file pattern association)
		this._register(this.notebookService.registerContributedNotebookType(
			QMD_VIEW_TYPE,
			{
				extension: new ExtensionIdentifier('positron.quarto-notebook'),
				displayName: 'Quarto Notebook',
				providerDisplayName: 'Positron',
				filenamePattern: ['*.qmd'],
				priority: RegisteredEditorPriority.default,
			}
		));

		// Register the serializer
		this._register(this.notebookService.registerNotebookSerializer(
			QMD_VIEW_TYPE,
			{ id: new ExtensionIdentifier('positron.quarto-notebook'), location: undefined },
			new QuartoNotebookSerializer(this.notebookService, this.fileService),
		));
	}
}

registerWorkbenchContribution2(
	QuartoNotebookContribution.ID,
	QuartoNotebookContribution,
	WorkbenchPhase.AfterRestored
);
