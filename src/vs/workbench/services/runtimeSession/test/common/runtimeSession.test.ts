/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { RuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSession';
import { URI } from 'vs/base/common/uri';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IOpener, IOpenerService } from 'vs/platform/opener/common/opener';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { LanguageService } from 'vs/editor/common/services/languageService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { TestExtensionService, TestStorageService, TestWorkspaceTrustManagementService } from 'vs/workbench/test/common/workbenchTestServices';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { LanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntime';
import { generateUuid } from 'vs/base/common/uuid';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { basename } from 'vs/base/common/path';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { ILanguageRuntimeSession, ILanguageRuntimeSessionManager, IRuntimeSessionMetadata } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';

const TestRuntimeLanguageVersion = '0.0.1';
const TestRuntimeShortName = TestRuntimeLanguageVersion;
const TestRuntimeName = `Test ${TestRuntimeShortName}`;

class TestOpenerService implements Partial<IOpenerService> {
	registerOpener(opener: IOpener): IDisposable {
		return { dispose() { } };
	}
}

class TestRuntimeSessionManager implements ILanguageRuntimeSessionManager {
	async managesRuntime(runtime: ILanguageRuntimeMetadata): Promise<boolean> {
		return true;
	}

	async createSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata): Promise<ILanguageRuntimeSession> {
		return new TestLanguageRuntimeSession(sessionMetadata, runtimeMetadata);
	}

	restoreSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata): Promise<ILanguageRuntimeSession> {
		throw new Error('Not implemented');
	}

	validateMetadata(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata> {
		throw new Error('Not implemented');
	}
}

function testLanguageRuntimeMetadata(): ILanguageRuntimeMetadata {
	const runtimeId = generateUuid();
	return {
		extensionId: new ExtensionIdentifier('test-extension'),
		base64EncodedIconSvg: '',
		extraRuntimeData: {},
		languageId: 'test',
		languageName: 'Test',
		languageVersion: TestRuntimeLanguageVersion,
		runtimeId,
		runtimeName: TestRuntimeName,
		runtimePath: '/test',
		runtimeShortName: TestRuntimeShortName,
		runtimeSource: 'Test',
		runtimeVersion: '0.0.1',
		sessionLocation: LanguageRuntimeSessionLocation.Browser,
		startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
	};
}

suite('Positron - RuntimeSessionService', () => {
	let runtimeSessionService: RuntimeSessionService;
	let runtime: ILanguageRuntimeMetadata;
	let notebookUri: URI;

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	setup(() => {
		const instantiationService = disposables.add(new TestInstantiationService());
		instantiationService.stub(IOpenerService, new TestOpenerService());
		instantiationService.stub(ILanguageService, disposables.add(instantiationService.createInstance(LanguageService)));
		instantiationService.stub(IExtensionService, new TestExtensionService());
		instantiationService.stub(IStorageService, disposables.add(new TestStorageService()));
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(IWorkspaceTrustManagementService, disposables.add(new TestWorkspaceTrustManagementService()));
		const languageRuntimeService = instantiationService.stub(ILanguageRuntimeService, disposables.add(instantiationService.createInstance(LanguageRuntimeService)));
		runtimeSessionService = disposables.add(instantiationService.createInstance(RuntimeSessionService));

		// Register a test runtime.
		runtime = testLanguageRuntimeMetadata();
		disposables.add(languageRuntimeService.registerRuntime(runtime));

		const manager = new TestRuntimeSessionManager();
		disposables.add(runtimeSessionService.registerSessionManager(manager));

		notebookUri = URI.file('some-notebook');
	});

	test('should start and shutdown runtime session', async () => {
		const sessionId = await runtimeSessionService.startNewRuntimeSession(
			runtime.runtimeId,
			basename(notebookUri.fsPath),
			LanguageRuntimeSessionMode.Notebook,
			notebookUri,
			'Test requested a runtime session',
		);
		const session = runtimeSessionService.getSession(sessionId);
		assert.ok(session, `Session with ID ${sessionId} not found after being started`);
		disposables.add(session);
	});
});
