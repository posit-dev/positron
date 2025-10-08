/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { DocumentPasteContext, DocumentPasteEdit, DocumentPasteEditProvider, DocumentPasteEditsSession } from '../../../../editor/common/languages.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { IReadonlyVSDataTransfer } from '../../../../base/common/dataTransfer.js';
import { HierarchicalKind } from '../../../../base/common/hierarchicalKind.js';
import { convertClipboardFiles } from '../../positronPathUtils/common/filePathConverter.js';

/**
 * Document paste edit provider for Positron console that converts file paths from clipboard.
 * This works with VS Code's advanced clipboard system that has access to file URIs.
 */
export class PositronConsolePasteProvider extends Disposable implements DocumentPasteEditProvider {

	readonly copyMimeTypes: readonly string[] = [];
	readonly pasteMimeTypes: readonly string[] = ['text/uri-list'];
	readonly providedPasteEditKinds: readonly HierarchicalKind[] = [new HierarchicalKind('text')];

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService
	) {
		super();

		// Register this provider for all languages initially
		// We'll filter by language in the provider logic
		this._register(this.languageFeaturesService.documentPasteEditProvider.register('*', this));
	}

	async provideDocumentPasteEdits(
		model: ITextModel,
		ranges: readonly IRange[],
		dataTransfer: IReadonlyVSDataTransfer,
		context: DocumentPasteContext,
		token: CancellationToken
	): Promise<DocumentPasteEditsSession | undefined> {

		// Only handle R language URIs that contain 'positron-console'
		if (model.getLanguageId() !== 'r' || !model.uri.toString().includes('positron-console')) {
			return undefined;
		}

		// Check if the setting is enabled
		const setting = this.configurationService.getValue<boolean>('positron.r.autoConvertFilePaths');
		if (!setting) {
			return undefined;
		}

		// Convert VS Code DataTransfer to browser-like DataTransfer for our utility function
		const mockDataTransfer = this.createMockDataTransfer(dataTransfer);

		// Try to convert clipboard files to R path format
		const convertedFiles = convertClipboardFiles(mockDataTransfer as DataTransfer);
		if (!convertedFiles) {
			return undefined;
		}

		// Return the paste edit session
		const edit: DocumentPasteEdit = {
			insertText: convertedFiles,
			title: 'Insert file path(s) for R',
			kind: new HierarchicalKind('text')
		};

		return {
			edits: [edit],
			dispose: () => { }
		};
	}

	/**
	 * Creates a mock DataTransfer object that our utility function can use.
	 * Converts from VS Code's VSDataTransfer to browser-like DataTransfer.
	 */
	private createMockDataTransfer(dataTransfer: IReadonlyVSDataTransfer): Pick<DataTransfer, 'types' | 'getData'> {
		const types: string[] = [];

		// Populate the types array
		for (const [mimeType] of dataTransfer) {
			types.push(mimeType);
		}

		return {
			types: types as readonly string[],
			getData: (format: string) => {
				const item = dataTransfer.get(format);
				if (!item) {
					return '';
				}
				// For synchronous access, we need to check if it's already a string
				if (typeof item.value === 'string') {
					return item.value;
				}
				// For async data, we can't handle it here, but text/uri-list should be synchronous
				return '';
			}
		};
	}
}