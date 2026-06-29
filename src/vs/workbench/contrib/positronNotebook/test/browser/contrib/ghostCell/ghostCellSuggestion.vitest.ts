/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AsyncIterableObject } from '../../../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../../base/common/cancellation.js';
import { Event } from '../../../../../../../base/common/event.js';
import { observableValue } from '../../../../../../../base/common/observable.js';
import { stubInterface } from '../../../../../../../test/vitest/stubInterface.js';
import { IHeadlessLanguageModelService, IStreamTextRequest, StreamTextResult, intentFromSetting } from '../../../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { IPositronNotebookCell, NotebookCellOutputs, ParsedOutput } from '../../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import {
	IGhostCellSnapshot,
	buildGhostCellContext,
	generateGhostCellSuggestion,
	parseGhostCellSuggestion,
	snapshotCells,
} from '../../../../browser/contrib/ghostCell/ghostCellSuggestion.js';

const VALID_XML = '<suggestion><explanation>Inspect it</explanation><code>df.head()</code></suggestion>';

function fakeService(result: StreamTextResult): IHeadlessLanguageModelService {
	return {
		_serviceBrand: undefined,
		streamText: async () => result,
		getAvailableModels: async () => [],
		onDidChangeAvailableModels: Event.None,
	};
}

function requestWith(model?: IStreamTextRequest['model']): IStreamTextRequest {
	return { systemPrompt: 's', messages: [{ role: 'user', content: 'c' }], model };
}

const noop = () => { };

describe('intentFromSetting', () => {
	it('maps an unset or empty value to the default fast/cheap tier', () => {
		expect(intentFromSetting(undefined)).toEqual({ tier: 'fast-cheap' });
		expect(intentFromSetting([])).toEqual({ tier: 'fast-cheap' });
	});

	it('maps any non-empty value to ordered patterns (a pinned id resolves via exact-match priority)', () => {
		expect(intentFromSetting(['claude-haiku'])).toEqual({ patterns: ['claude-haiku'] });
		expect(intentFromSetting(['haiku', 'mini'])).toEqual({ patterns: ['haiku', 'mini'] });
	});
});

describe('parseGhostCellSuggestion', () => {
	it('parses explanation and code from the streamed XML', async () => {
		const onProgress = vi.fn();
		const result = await parseGhostCellSuggestion(AsyncIterableObject.fromArray([VALID_XML]), onProgress, CancellationToken.None);
		expect(result).toEqual({ code: 'df.head()', explanation: 'Inspect it' });
		expect(onProgress).toHaveBeenCalled();
	});

	it('streams partial code across chunk boundaries', async () => {
		const onProgress = vi.fn();
		const chunks = ['<explanation>Hi</explanation><code>df.', 'head()</code>'];
		const result = await parseGhostCellSuggestion(AsyncIterableObject.fromArray(chunks), onProgress, CancellationToken.None);
		expect(result?.code).toBe('df.head()');
		// A partial code update was reported before the closing tag arrived.
		expect(onProgress.mock.calls.some(([partial]) => partial.code === 'df.')).toBe(true);
	});

	it('returns undefined when no code is produced (benign empty)', async () => {
		const result = await parseGhostCellSuggestion(AsyncIterableObject.fromArray(['<explanation>nothing useful</explanation>']), noop, CancellationToken.None);
		expect(result).toBeUndefined();
	});

	it('keeps code that contains angle-bracket operators intact', async () => {
		const xml = '<suggestion><explanation>Guard</explanation><code>if x < 5:\n    pass</code></suggestion>';
		const result = await parseGhostCellSuggestion(AsyncIterableObject.fromArray([xml]), noop, CancellationToken.None);
		expect(result?.code).toBe('if x < 5:\n    pass');
	});

	it('parses XML wrapped in a markdown code fence', async () => {
		const fenced = '```xml\n' + VALID_XML + '\n```';
		const result = await parseGhostCellSuggestion(AsyncIterableObject.fromArray([fenced]), noop, CancellationToken.None);
		expect(result).toEqual({ code: 'df.head()', explanation: 'Inspect it' });
	});

	it('drops prose surrounding a fenced suggestion', async () => {
		const wrapped = 'Here is the next step:\n\n```xml\n' + VALID_XML + '\n```\n\nLet me know if that helps.';
		const result = await parseGhostCellSuggestion(AsyncIterableObject.fromArray([wrapped]), noop, CancellationToken.None);
		expect(result).toEqual({ code: 'df.head()', explanation: 'Inspect it' });
	});

	it('tolerates attributes on the code tag', async () => {
		const xml = '<suggestion><explanation>Inspect</explanation><code language="python">df.head()</code></suggestion>';
		const result = await parseGhostCellSuggestion(AsyncIterableObject.fromArray([xml]), noop, CancellationToken.None);
		expect(result?.code).toBe('df.head()');
	});

	it('returns undefined when cancelled mid-stream', async () => {
		const cts = new CancellationTokenSource();
		// Cancel after the first chunk is delivered; the loop checks the token
		// before processing the next chunk, so the suggestion is abandoned.
		async function* stream(): AsyncGenerator<string> {
			yield '<code>df.';
			cts.cancel();
			yield 'head()</code>';
		}
		const result = await parseGhostCellSuggestion(stream(), noop, cts.token);
		expect(result).toBeUndefined();
	});
});

describe('generateGhostCellSuggestion (failure-to-UX mapping)', () => {
	it('maps an unavailable result to a typed unavailable outcome', async () => {
		const service = fakeService({ available: false, reason: 'sign-in-required' });
		const outcome = await generateGhostCellSuggestion(service, requestWith(), CancellationToken.None, noop);
		expect(outcome).toEqual({ kind: 'unavailable', reason: 'sign-in-required' });
	});

	it('maps a streamed suggestion to a ready outcome with the model name', async () => {
		const service = fakeService({ available: true, model: { id: 'm', name: 'Haiku' }, usedFallback: false, text: AsyncIterableObject.fromArray([VALID_XML]) });
		const outcome = await generateGhostCellSuggestion(service, requestWith(), CancellationToken.None, noop);
		expect(outcome).toEqual({ kind: 'ready', code: 'df.head()', explanation: 'Inspect it', modelName: 'Haiku', usedFallback: false });
	});

	it('maps a benign empty response to a silent empty outcome', async () => {
		const service = fakeService({ available: true, model: { id: 'm', name: 'Haiku' }, usedFallback: false, text: AsyncIterableObject.fromArray(['<explanation>nothing</explanation>']) });
		const outcome = await generateGhostCellSuggestion(service, requestWith(), CancellationToken.None, noop);
		expect(outcome).toEqual({ kind: 'empty' });
	});

	it('maps a mid-stream failure to an error outcome', async () => {
		const throwing: AsyncIterable<string> = {
			[Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('provider unreachable')) }),
		};
		const service = fakeService({ available: true, model: { id: 'm', name: 'Haiku' }, usedFallback: false, text: throwing });
		const outcome = await generateGhostCellSuggestion(service, requestWith(), CancellationToken.None, noop);
		expect(outcome).toEqual({ kind: 'error', message: 'provider unreachable' });
	});

	it('propagates the service-reported fallback (e.g. a pinned model is gone)', async () => {
		const service = fakeService({ available: true, model: { id: 'd', name: 'Default' }, usedFallback: true, text: AsyncIterableObject.fromArray([VALID_XML]) });
		const outcome = await generateGhostCellSuggestion(service, requestWith({ patterns: ['pinned'] }), CancellationToken.None, noop);
		expect(outcome).toEqual({ kind: 'ready', code: 'df.head()', explanation: 'Inspect it', modelName: 'Default', usedFallback: true });
	});
});

describe('snapshotCells', () => {
	function cell(source: string, isCode: boolean, ...parsed: ParsedOutput[]): IPositronNotebookCell {
		const outputs: NotebookCellOutputs[] = parsed.map((p, i) => ({ outputId: `o${i}`, outputs: [], parsed: p }));
		return stubInterface<IPositronNotebookCell>({
			getContent: () => source,
			isCodeCell: (() => isCode) as IPositronNotebookCell['isCodeCell'],
			outputs: observableValue('outputs', outputs),
		});
	}

	it('gathers outputs only for the executed cell', () => {
		const cells = [
			cell('a = 1', true, { type: 'stdout', content: 'first' }),
			cell('a', true, { type: 'stdout', content: 'second' }),
		];
		const snapshots = snapshotCells(cells, () => 'python', 1);
		expect(snapshots.map(({ source, outputs }) => ({ source, outputs }))).toEqual([
			{ source: 'a = 1', outputs: '' },
			{ source: 'a', outputs: 'second' },
		]);
	});

	it('strips ANSI escape codes and truncates long outputs', () => {
		const long = 'x'.repeat(1500);
		const cells = [cell('err()', true,
			{ type: 'stderr', content: '\u001b[31mTraceback\u001b[0m' },
			{ type: 'stdout', content: long },
		)];
		const [snapshot] = snapshotCells(cells, () => 'python', 0);
		expect(snapshot.outputs).toBe(`Traceback\n${'x'.repeat(1000)}...`);
		expect(snapshot.hasError).toBe(true);
	});

	it('flags errors for stderr, error, and interrupt outputs', () => {
		for (const parsed of [
			{ type: 'error', content: 'boom' },
			{ type: 'interrupt', trace: 'KeyboardInterrupt' },
		] as ParsedOutput[]) {
			const [snapshot] = snapshotCells([cell('x', true, parsed)], () => 'python', 0);
			expect(snapshot.hasError).toBe(true);
		}
	});

	it('skips non-text outputs and markdown cells', () => {
		const cells = [
			cell('![img]', false, { type: 'image', dataUrl: 'data:image/png;base64,' }),
			cell('plot()', true, { type: 'image', dataUrl: 'data:image/png;base64,' }, { type: 'json', data: {} }),
		];
		const snapshots = snapshotCells(cells, () => 'python', 1);
		expect(snapshots.map(({ isCode, outputs, hasError }) => ({ isCode, outputs, hasError }))).toEqual([
			{ isCode: false, outputs: '', hasError: false },
			{ isCode: true, outputs: '', hasError: false },
		]);
	});
});

describe('buildGhostCellContext', () => {
	it('includes the executed cell, its output, and prior cells', () => {
		const cells: IGhostCellSnapshot[] = [
			{ source: 'import pandas as pd', language: 'python', isCode: true, outputs: '', hasError: false },
			{ source: 'df = pd.read_csv("x.csv")', language: 'python', isCode: true, outputs: 'loaded', hasError: false },
		];
		const context = buildGhostCellContext(cells, 1);
		expect(context).toContain('## Just Executed Cell (Cell 2)');
		expect(context).toContain('df = pd.read_csv("x.csv")');
		expect(context).toContain('## Cell Output');
		expect(context).toContain('loaded');
		expect(context).toContain('## Previous Context');
		expect(context).toContain('import pandas as pd');
	});

	const oneCell: IGhostCellSnapshot[] = [
		{ source: 'df = load()', language: 'python', isCode: true, outputs: '', hasError: false },
	];

	it('renders session variables, prioritized and capped at maxVariables', () => {
		const variables = [
			{ name: 'n', type: 'int' },          // priority 3
			{ name: 'df', type: 'DataFrame' },    // priority 1
			{ name: 'items', type: 'list' },      // priority 2
		];
		const context = buildGhostCellContext(oneCell, 0, variables, 2);
		expect(context).toContain('## Session Variables');
		// DataFrame and list outrank the scalar; the cap of 2 drops the int.
		expect(context).toContain('df|DataFrame');
		expect(context).toContain('items|list');
		expect(context).not.toContain('n|int');
	});

	it('omits the session variables block when none are provided', () => {
		expect(buildGhostCellContext(oneCell, 0)).not.toContain('## Session Variables');
	});
});
