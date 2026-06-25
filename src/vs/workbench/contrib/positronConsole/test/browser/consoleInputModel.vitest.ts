/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createConsoleInputModel } from '../../browser/components/consoleInputModel.js';

describe('createConsoleInputModel', () => {
	// Capture the resource passed to createModel and echo it back on the model so
	// the model's uri matches what was registered, mirroring the real ModelService.
	function setup() {
		let createdResource: URI | undefined;
		const modelService = stubInterface<IModelService>({
			createModel: vi.fn((_value, _language, resource?: URI) => {
				createdResource = resource;
				return stubInterface<ITextModel>({ uri: resource! });
			})
		});
		const refDispose = vi.fn();
		const textModelService = stubInterface<ITextModelService>({
			createModelReference: vi.fn().mockResolvedValue({ object: {}, dispose: refDispose })
		});
		const languageService = stubInterface<ILanguageService>({
			createById: vi.fn().mockReturnValue(undefined)
		});
		return { modelService, textModelService, languageService, refDispose, getCreatedResource: () => createdResource };
	}

	it('creates an in-memory model and holds a reference to it', async () => {
		const { modelService, textModelService, languageService } = setup();
		const store = new DisposableStore();

		const model = createConsoleInputModel(modelService, textModelService, languageService, 'r', false, store);

		// The created model is returned, and a reference is acquired for its URI.
		expect(model.uri.scheme).toBe('inmemory');
		expect(textModelService.createModelReference).toHaveBeenCalledWith(model.uri);

		store.dispose();
	});

	it('releases the held reference when the store is disposed', async () => {
		const { modelService, textModelService, languageService, refDispose } = setup();
		const store = new DisposableStore();

		createConsoleInputModel(modelService, textModelService, languageService, 'r', false, store);

		// The reference is acquired asynchronously; let it resolve and register.
		await Promise.resolve();
		expect(refDispose).not.toHaveBeenCalled();

		// Disposing the store releases the console's own reference, which on the
		// real resolver is what finally allows the model to be disposed.
		store.dispose();
		expect(refDispose).toHaveBeenCalledTimes(1);
	});
});
