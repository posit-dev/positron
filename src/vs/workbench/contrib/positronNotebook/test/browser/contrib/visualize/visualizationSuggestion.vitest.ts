/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AsyncIterableObject } from '../../../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../../../base/common/cancellation.js';
import { Event } from '../../../../../../../base/common/event.js';
import { stubInterface } from '../../../../../../../test/vitest/stubInterface.js';
import { IHeadlessLanguageModelService, StreamTextResult } from '../../../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { IPositronNotebookCell } from '../../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { DataFrameColumn } from '../../../../browser/contrib/visualize/visualizeModalDialog.js';
import {
	generateVisualizationSuggestion,
	parseVisualizationSuggestion,
} from '../../../../browser/contrib/visualize/visualizationSuggestion.js';

const COLUMNS: DataFrameColumn[] = [{ name: 'a', type: 'int64' }, { name: 'b', type: 'float64' }];

const VALID_JSON = JSON.stringify({
	library: 'plotly',
	chartType: 'scatter',
	xCol: 'a',
	yCol: 'b',
	reasoning: { library: 'already imported', chartType: 'two numerics', columns: 'a vs b' },
});

function fakeService(result: StreamTextResult): IHeadlessLanguageModelService {
	return {
		_serviceBrand: undefined,
		streamText: async () => result,
		getAvailableModels: async () => [],
		onDidChangeAvailableModels: Event.None,
	};
}

function codeCell(source: string): IPositronNotebookCell {
	return stubInterface<IPositronNotebookCell>({
		getContent: () => source,
		isCodeCell: (() => true) as IPositronNotebookCell['isCodeCell'],
	});
}

describe('parseVisualizationSuggestion', () => {
	it('parses a clean JSON object into a typed suggestion', () => {
		const result = parseVisualizationSuggestion(VALID_JSON, COLUMNS);
		expect(result).toEqual({
			library: 'plotly',
			chartType: 'scatter',
			xCol: 'a',
			yCol: 'b',
			reasoning: { library: 'already imported', chartType: 'two numerics', columns: 'a vs b' },
		});
	});

	it('tolerates markdown fences and surrounding prose', () => {
		const wrapped = 'Here you go:\n```json\n' + VALID_JSON + '\n```\nHope that helps.';
		expect(parseVisualizationSuggestion(wrapped, COLUMNS)?.library).toBe('plotly');
	});

	it('rejects an invalid library', () => {
		const bad = JSON.stringify({ library: 'ggplot', chartType: 'bar', xCol: 'a', yCol: null, reasoning: {} });
		expect(parseVisualizationSuggestion(bad, COLUMNS)).toBeNull();
	});

	it('coerces an out-of-list xCol to the first column and drops an invalid yCol', () => {
		const json = JSON.stringify({ library: 'seaborn', chartType: 'histogram', xCol: 'missing', yCol: 'also-missing', reasoning: {} });
		const result = parseVisualizationSuggestion(json, COLUMNS);
		expect(result).toMatchObject({ xCol: 'a', yCol: null });
	});

	it('returns null when no JSON object is present', () => {
		expect(parseVisualizationSuggestion('no json here', COLUMNS)).toBeNull();
	});
});

describe('generateVisualizationSuggestion', () => {
	const cells = [codeCell('import plotly'), codeCell('df')];

	it('returns null when the service is unavailable', async () => {
		const service = fakeService({ available: false, reason: 'no-providers-configured' });
		const result = await generateVisualizationSuggestion(service, cells, 1, 'df', COLUMNS, undefined, CancellationToken.None);
		expect(result).toBeNull();
	});

	it('returns the parsed suggestion with the model name when the service streams JSON', async () => {
		const service = fakeService({ available: true, model: { id: 'm', name: 'Haiku' }, usedFallback: false, text: AsyncIterableObject.fromArray([VALID_JSON]) });
		const result = await generateVisualizationSuggestion(service, cells, 1, 'df', COLUMNS, undefined, CancellationToken.None);
		expect(result).toMatchObject({ library: 'plotly', chartType: 'scatter', xCol: 'a', yCol: 'b', modelName: 'Haiku' });
	});
});
