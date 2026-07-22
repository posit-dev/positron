/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { IEditor, IEditorDecorationsCollection } from '../../../../../editor/common/editorCommon.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IStatementRange } from '../../../../../editor/common/languages.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import {
	BARBERPOLE_DELAY_MS,
	EditorCodeSubmissionService,
	WIDGET_DELAY_MS,
} from '../../browser/editorCodeSubmission/editorCodeSubmissionService.js';

describe('EditorCodeSubmissionService', () => {
	let service: EditorCodeSubmissionService;
	let model: ITextModel;
	let editor: IEditor;
	let decorations: IEditorDecorationsCollection;

	beforeEach(() => {
		vi.useFakeTimers();
		service = new EditorCodeSubmissionService();
		model = stubInterface<ITextModel>({ uri: URI.parse('file:///test.R') });
		decorations = stubInterface<IEditorDecorationsCollection>({ clear: vi.fn() });
		editor = stubInterface<IEditor>({
			createDecorationsCollection: vi.fn().mockReturnValue(decorations),
		});
	});

	afterEach(() => {
		service.dispose();
		vi.useRealTimers();
	});

	it('shows no visuals when the provider responds before the barber pole delay', async () => {
		const work = new DeferredPromise<IStatementRange | null>();
		const detection = service.beginStatementRangeDetection(editor, model, 5);

		const waitPromise = detection.wait(work.p);
		work.complete(null);
		const outcome = await waitPromise;

		expect(outcome).toEqual({ kind: 'result', value: null });
		expect(editor.createDecorationsCollection).not.toHaveBeenCalled();
		expect(service.activeSubmission).toBeUndefined();

		detection.dispose();
	});

	it('fades the gutter barber pole in after the barber pole delay', () => {
		const detection = service.beginStatementRangeDetection(editor, model, 7);

		vi.advanceTimersByTime(BARBERPOLE_DELAY_MS);

		// The decoration is applied to the cursor's line (1-based).
		expect(editor.createDecorationsCollection).toHaveBeenCalledTimes(1);
		const args = vi.mocked(editor.createDecorationsCollection).mock.calls[0][0]!;
		expect(args[0].range.startLineNumber).toBe(7);
		expect(service.activeSubmission).toBeUndefined();

		detection.dispose();
	});

	it('surfaces the widget submission after the widget delay and fires a change', () => {
		const onDidChangeState = vi.fn();
		service.onDidChangeState(onDidChangeState);
		const detection = service.beginStatementRangeDetection(editor, model, 3);

		vi.advanceTimersByTime(WIDGET_DELAY_MS);

		expect(service.activeSubmission).toEqual({ uri: model.uri, line: 3 });
		expect(onDidChangeState).toHaveBeenCalledTimes(1);

		detection.dispose();
	});

	it('resolves the race with "cancel" and cancels the token when cancelled', async () => {
		const work = new DeferredPromise<IStatementRange | null>();
		const detection = service.beginStatementRangeDetection(editor, model, 1);

		const waitPromise = detection.wait(work.p);
		service.cancel();
		const outcome = await waitPromise;

		expect(outcome).toEqual({ kind: 'cancel' });
		expect(detection.token.isCancellationRequested).toBe(true);
	});

	it('resolves the race with "runAsIs" when the user runs as-is', async () => {
		const work = new DeferredPromise<IStatementRange | null>();
		const detection = service.beginStatementRangeDetection(editor, model, 1);

		const waitPromise = detection.wait(work.p);
		service.runAsIs();
		const outcome = await waitPromise;

		expect(outcome).toEqual({ kind: 'runAsIs' });
	});

	it('reports provider errors as an "error" outcome', async () => {
		const work = new DeferredPromise<IStatementRange | null>();
		const detection = service.beginStatementRangeDetection(editor, model, 1);

		const waitPromise = detection.wait(work.p);
		const error = new Error('boom');
		work.error(error);
		const outcome = await waitPromise;

		expect(outcome).toEqual({ kind: 'error', error });
		detection.dispose();
	});

	it('clears the barber pole and widget on dispose', () => {
		const onDidChangeState = vi.fn();
		service.onDidChangeState(onDidChangeState);
		const detection = service.beginStatementRangeDetection(editor, model, 1);

		vi.advanceTimersByTime(WIDGET_DELAY_MS);
		expect(service.activeSubmission).toBeDefined();
		onDidChangeState.mockClear();

		detection.dispose();

		expect(decorations.clear).toHaveBeenCalledTimes(1);
		expect(service.activeSubmission).toBeUndefined();
		expect(onDidChangeState).toHaveBeenCalledTimes(1);
	});

	it('does not create a decoration when there is no editor', () => {
		const detection = service.beginStatementRangeDetection(undefined, model, 1);

		vi.advanceTimersByTime(WIDGET_DELAY_MS);

		expect(service.activeSubmission).toEqual({ uri: model.uri, line: 1 });
		detection.dispose();
	});
});
