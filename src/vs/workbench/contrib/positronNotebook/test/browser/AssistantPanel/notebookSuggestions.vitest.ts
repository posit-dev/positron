/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AsyncIterableObject } from '../../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Event } from '../../../../../../base/common/event.js';
import { ChatModeKind } from '../../../../chat/common/constants.js';
import { INotebookContextDTO, NotebookCellType } from '../../../../../common/positron/notebookAssistant.js';
import { IHeadlessLanguageModelService, StreamTextResult } from '../../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import {
	buildSuggestionsContext,
	generateNotebookSuggestions,
	parseNotebookSuggestions,
} from '../../../browser/AssistantPanel/notebookSuggestions.js';

const VALID_XML = '<suggestions><suggestion><label>Inspect</label><query>Show df.head()</query><mode>ask</mode></suggestion></suggestions>';

function fakeService(result: StreamTextResult): IHeadlessLanguageModelService {
	return {
		_serviceBrand: undefined,
		streamText: async () => result,
		getAvailableModels: async () => [],
		onDidChangeAvailableModels: Event.None,
	};
}

function contextWith(): INotebookContextDTO {
	return {
		uri: 'file:///n.ipynb',
		kernelLanguage: 'python',
		cellCount: 1,
		selectedCells: [],
		allCells: [{ id: 'c0', index: 0, type: NotebookCellType.Code, content: 'df.head()', hasOutput: true, selectionStatus: 'unselected', lastRunSuccess: false }],
	};
}

const noop = () => { };

describe('parseNotebookSuggestions', () => {
	it('parses suggestions from the streamed XML and reports progress', async () => {
		const onProgress = vi.fn();
		const result = await parseNotebookSuggestions(AsyncIterableObject.fromArray([VALID_XML]), onProgress, CancellationToken.None);
		expect(result).toEqual([{ label: 'Inspect', detail: undefined, query: 'Show df.head()', mode: ChatModeKind.Ask, iconClass: undefined }]);
		expect(onProgress).toHaveBeenCalled();
	});

	it('normalizes an unknown mode to Agent and drops suggestions missing label or query', async () => {
		const xml = '<suggestions>'
			+ '<suggestion><label>No query</label><mode>ask</mode></suggestion>'
			+ '<suggestion><label>Do it</label><query>Run the thing</query><mode>bogus</mode></suggestion>'
			+ '</suggestions>';
		const result = await parseNotebookSuggestions(AsyncIterableObject.fromArray([xml]), noop, CancellationToken.None);
		expect(result).toEqual([{ label: 'Do it', detail: undefined, query: 'Run the thing', mode: ChatModeKind.Agent, iconClass: undefined }]);
	});

	it('caps the result at five suggestions', async () => {
		const one = '<suggestion><label>L</label><query>Q</query><mode>edit</mode></suggestion>';
		const xml = `<suggestions>${one.repeat(7)}</suggestions>`;
		const result = await parseNotebookSuggestions(AsyncIterableObject.fromArray([xml]), noop, CancellationToken.None);
		expect(result).toHaveLength(5);
	});

	it('returns an empty array when no suggestions are produced', async () => {
		const result = await parseNotebookSuggestions(AsyncIterableObject.fromArray(['no xml here']), noop, CancellationToken.None);
		expect(result).toEqual([]);
	});
});

describe('generateNotebookSuggestions', () => {
	it('throws the typed reason when the service is unavailable', async () => {
		const service = fakeService({ available: false, reason: 'sign-in-required' });
		await expect(generateNotebookSuggestions(service, contextWith(), undefined, CancellationToken.None, noop)).rejects.toThrow('sign-in-required');
	});

	it('returns the parsed suggestions when the service streams a response', async () => {
		const service = fakeService({ available: true, model: { id: 'm', name: 'Haiku' }, usedFallback: false, text: AsyncIterableObject.fromArray([VALID_XML]) });
		const result = await generateNotebookSuggestions(service, contextWith(), undefined, CancellationToken.None, noop);
		expect(result).toEqual([{ label: 'Inspect', detail: undefined, query: 'Show df.head()', mode: ChatModeKind.Ask, iconClass: undefined }]);
	});
});

describe('buildSuggestionsContext', () => {
	it('summarizes the kernel, cell content, and a failed cell status', () => {
		const context = buildSuggestionsContext(contextWith());
		expect(context).toContain('Kernel language: python');
		expect(context).toContain('df.head()');
		expect(context).toContain('failed');
	});
});
