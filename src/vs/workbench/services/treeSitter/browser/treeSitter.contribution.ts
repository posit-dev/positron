/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { URI } from '../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ITreeSitterLibraryService } from '../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { ITreeSitterThemeService } from '../../../../editor/common/services/treeSitter/treeSitterThemeService.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ITextFileService } from '../../textfile/common/textfiles.js';
import { TreeSitterLibraryService } from './treeSitterLibraryService.js';
import { TreeSitterThemeService } from './treeSitterThemeService.js';

registerSingleton(ITreeSitterLibraryService, TreeSitterLibraryService, InstantiationType.Eager);
registerSingleton(ITreeSitterThemeService, TreeSitterThemeService, InstantiationType.Eager);

CommandsRegistry.registerCommand('_workbench.colorizeTreeSitterTokens', async (accessor: ServicesAccessor, resource?: URI): Promise<{ parseTime: number; captureTime: number; metadataTime: number }> => {
	const textModelService = accessor.get(ITextFileService);
	const treeSitterLibraryService = accessor.get(ITreeSitterLibraryService);
	const treeSitterThemeService = accessor.get(ITreeSitterThemeService);
	const languageService = accessor.get(ILanguageService);

	const textModel = resource ? (await textModelService.files.resolve(resource)).textEditorModel : undefined;
	if (!textModel) {
		throw new Error(`Cannot resolve text model for resource ${resource}`);
	}

	const languageId = textModel.getLanguageId();
	const parserClass = await treeSitterLibraryService.getParserClass();
	const treeSitterLanguage = await treeSitterLibraryService.getLanguagePromise(languageId);
	if (!treeSitterLanguage) {
		throw new Error(`Cannot resolve tree-sitter language for ${languageId}`);
	}

	const parser = new parserClass();
	parser.setLanguage(treeSitterLanguage);

	const content = textModel.getValue();

	// Time parsing
	const parseStopwatch = StopWatch.create();
	const tree = parser.parse(content);
	parseStopwatch.stop();
	const parseTime = parseStopwatch.elapsed();

	if (!tree) {
		parser.delete();
		throw new Error(`Failed to parse content for ${resource}`);
	}

	// Wait for highlighting queries to be loaded (they load asynchronously via observables)
	let highlightQueries = treeSitterLibraryService.getHighlightingQueries(languageId, undefined);
	const maxWaitTime = 5000;
	const pollInterval = 50;
	let waited = 0;
	while (!highlightQueries && waited < maxWaitTime) {
		await timeout(pollInterval);
		waited += pollInterval;
		highlightQueries = treeSitterLibraryService.getHighlightingQueries(languageId, undefined);
	}
	if (!highlightQueries) {
		tree.delete();
		parser.delete();
		throw new Error(`Cannot resolve highlighting queries for ${languageId}`);
	}

	const captureStopwatch = StopWatch.create();
	const captures = highlightQueries.captures(tree.rootNode);
	captureStopwatch.stop();
	const captureTime = captureStopwatch.elapsed();

	const metadataStopwatch = StopWatch.create();
	const encodedLanguageId = languageService.languageIdCodec.encodeLanguageId(languageId);
	for (const capture of captures) {
		treeSitterThemeService.findMetadata([capture.name], encodedLanguageId, false, undefined);
	}
	metadataStopwatch.stop();
	const metadataTime = metadataStopwatch.elapsed();

	tree.delete();
	parser.delete();

	return { parseTime, captureTime, metadataTime };
});
