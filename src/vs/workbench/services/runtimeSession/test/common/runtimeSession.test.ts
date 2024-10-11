/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { RuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSession';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';
import { ILanguageRuntimeSessionManager, ILanguageRuntimeSession, RuntimeState, ILanguageRuntimeMetadata } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { URI } from 'vs/base/common/uri';
import { DeferredPromise } from 'vs/base/common/async';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { LanguageRuntimeSessionMode } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IOpener, IOpenerService } from 'vs/platform/opener/common/opener';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { LanguageService } from 'vs/editor/common/services/languageService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { TestExtensionService, TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';
import { IStorageService } from 'vs/platform/storage/common/storage';

class TestOpenerService implements Partial<IOpenerService> {
	registerOpener(opener: IOpener): IDisposable {
		return { dispose() { } };
	}
}

suite('Positron - RuntimeSessionService', () => {
	let runtimeSessionService: RuntimeSessionService;
	// let testSession: TestLanguageRuntimeSession;
	// let testManager: ILanguageRuntimeSessionManager;
	let notebookUri: URI;

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	setup(() => {
		const instantiationService = disposables.add(new TestInstantiationService());
		instantiationService.stub(IOpenerService, new TestOpenerService());
		instantiationService.stub(ILanguageService, disposables.add(instantiationService.createInstance(LanguageService)));
		instantiationService.stub(IExtensionService, new TestExtensionService());
		instantiationService.stub(IStorageService, disposables.add(new TestStorageService()));
		runtimeSessionService = disposables.add(instantiationService.createInstance(RuntimeSessionService));
		notebookUri = URI.file('some-notebook');
	});

	test('should start and shutdown runtime session', async () => {
		runtimeSessionService.startNewRuntimeSession(
			'runtimeId',
			'sessionName',
			LanguageRuntimeSessionMode.Notebook,
			notebookUri,
			'source',
		);
	});
});
