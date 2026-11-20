/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILanguageSelection, ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { blobResource, CHECKPOINTS_SCHEME, CheckpointsContentProvider, messageResource } from '../../browser/checkpointsContentProvider.js';
import { FakeCheckpointsEngine } from './fakeCheckpointsEngine.js';

describe('CheckpointsContentProvider', () => {
	const registered: { scheme: string; provider: ITextModelContentProvider }[] = [];
	const created: { text: string; resource: URI }[] = [];

	const ctx = createTestContainer()
		.stub(ITextModelService, {
			registerTextModelContentProvider: (scheme: string, provider: ITextModelContentProvider) => {
				registered.push({ scheme, provider });
				return toDisposable(() => { });
			},
		})
		.stub(IModelService, {
			getModel: () => null,
			createModel: (text: string, _language: unknown, resource: URI) => { created.push({ text, resource }); return stubInterface<ITextModel>({}); },
		})
		.stub(ILanguageService, { createByFilepathOrFirstLine: () => stubInterface<ILanguageSelection>({}) })
		.build();

	let engine: FakeCheckpointsEngine;
	let provider: CheckpointsContentProvider;

	beforeEach(() => {
		registered.length = 0;
		created.length = 0;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		provider = ctx.disposables.add(ctx.instantiationService.createInstance(CheckpointsContentProvider));
	});

	test('registers for the positron-checkpoints scheme', () => {
		expect(registered.map(entry => entry.scheme)).toEqual([CHECKPOINTS_SCHEME]);
		expect(registered[0].provider).toBe(provider);
	});

	test('a blob resource reads the blob named by its query', async () => {
		engine.blobs.set('abc123', VSBuffer.fromString('x <- 0\n'));

		await provider.provideTextContent(blobResource('analysis/dose.R', 'abc123'));

		expect(engine.callsOf('readBlob')).toEqual([['abc123']]);
		expect(created.map(model => [model.text, model.resource.path])).toEqual([['x <- 0\n', '/analysis/dose.R']]);
	});

	test('an empty query is an empty text and reads no blob', async () => {
		await provider.provideTextContent(blobResource('analysis/dose.R', ''));

		expect(engine.callsOf('readBlob')).toEqual([]);
		expect(created.map(model => model.text)).toEqual(['']);
	});

	test('a message resource gives its message back, including percent signs and line ends', async () => {
		const message = 'Before: 100%.\nNow: 2 MB.';

		await provider.provideTextContent(URI.parse(messageResource('plot.png', message).toString()));

		expect(created.map(model => model.text)).toEqual([message]);
	});

	test('a blob that cannot be read gives no model', async () => {
		engine.readBlob = async () => { throw new Error('gone'); };

		expect(await provider.provideTextContent(blobResource('analysis/dose.R', 'abc123'))).toBeNull();
		expect(created).toEqual([]);
	});
});
