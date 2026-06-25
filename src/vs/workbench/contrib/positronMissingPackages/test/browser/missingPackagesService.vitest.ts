/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronPackagesService } from '../../../positronPackages/browser/interfaces/positronPackagesService.js';
import { IPositronPackagesInstance } from '../../../positronPackages/browser/positronPackagesInstance.js';
import { ILanguageRuntimePackageManager, ILanguageRuntimeSession, IRuntimeMissingPackage, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { MissingPackagesService } from '../../browser/missingPackagesServiceImpl.js';
import { IMissingPackagesService } from '../../common/missingPackagesService.js';

describe('MissingPackagesService', () => {
	const resource = URI.file('/workspace/foo.py');
	const sessionId = 'python-session-1';

	// Mutable content/language driven by the fake open model.
	let modelLanguageId: string;
	let modelContent: string | null;

	// Describe-level emitters so the builder captures their `.event` references.
	const onDidChangePackages = new Emitter<string[]>();
	const onDidDeleteRuntimeSession = new Emitter<string>();

	// The session's package manager (also the install fallback path).
	const installPackages = vi.fn().mockResolvedValue(undefined);
	const packageManager = stubInterface<ILanguageRuntimePackageManager>({ installPackages });

	// The analyzer result, controllable per test.
	const listMissingPackages = vi.fn<(...args: unknown[]) => Promise<IRuntimeMissingPackage[]>>()
		.mockResolvedValue([{ name: 'requests' }]);

	const session = stubInterface<ILanguageRuntimeSession>({
		sessionId,
		listMissingPackages,
		getPackageManager: () => packageManager,
	});

	const instanceInstallPackages = vi.fn().mockResolvedValue(undefined);
	const packagesInstance = stubInterface<IPositronPackagesInstance>({
		session,
		onDidChangePackages: onDidChangePackages.event,
		installPackages: instanceInstallPackages,
	});

	const ctx = createTestContainer()
		.stub(IRuntimeSessionService, {
			onWillStartSession: Event.None,
			onDidChangeForegroundSession: Event.None,
			onDidDeleteRuntimeSession: onDidDeleteRuntimeSession.event,
			getConsoleSessionForLanguage: (languageId: string) => (languageId === 'python' ? session : undefined),
			getSession: (id: string) => (id === sessionId ? session : undefined),
		})
		.stub(IPositronPackagesService, {
			onDidChangeActivePackagesInstance: Event.None,
			getInstances: () => [packagesInstance],
		})
		.stub(IModelService, {
			getModel: () => (modelContent === null
				? null
				: stubInterface<ITextModel>({ getLanguageId: () => modelLanguageId, getValue: () => modelContent! })),
		})
		.stub(ITextModelService, {})
		.stub(ILogService, new NullLogService())
		.build();

	function createService(): IMissingPackagesService {
		return ctx.disposables.add(ctx.instantiationService.createInstance(MissingPackagesService));
	}

	beforeEach(() => {
		modelLanguageId = 'python';
		modelContent = 'import requests';
	});

	it('computes, caches, and serves the cached result without recomputing', async () => {
		const service = createService();

		const result = await service.ensure(resource);
		expect({ ...result, resource: result.resource.toString() }).toMatchInlineSnapshot(`
			{
			  "groups": [
			    {
			      "languageId": "python",
			      "packages": [
			        {
			          "name": "requests",
			        },
			      ],
			      "sessionId": "python-session-1",
			    },
			  ],
			  "resource": "file:///workspace/foo.py",
			  "total": 1,
			}
		`);

		// getCached returns the same result; the analyzer is not called again.
		const cached = service.getCached(resource);
		expect(cached?.total).toBe(1);
		expect(listMissingPackages).toHaveBeenCalledTimes(1);
	});

	it('dedupes concurrent computations by cache key', async () => {
		const service = createService();

		await Promise.all([service.ensure(resource), service.ensure(resource)]);

		expect(listMissingPackages).toHaveBeenCalledTimes(1);
	});

	it('getCached never triggers work', () => {
		const service = createService();

		expect(service.getCached(resource)).toBeUndefined();
		expect(listMissingPackages).not.toHaveBeenCalled();
	});

	it('invalidates a session on package change and notifies the resource', async () => {
		const service = createService();
		await service.ensure(resource);

		const changed: URI[] = [];
		ctx.disposables.add(service.onDidChangeMissingPackages(uri => changed.push(uri)));

		onDidChangePackages.fire(['requests']);

		expect(changed.map(uri => uri.toString())).toEqual([resource.toString()]);
		expect(service.getCached(resource)).toBeUndefined();
	});

	it('recomputes when the content hash changes', async () => {
		const service = createService();
		await service.ensure(resource);
		expect(listMissingPackages).toHaveBeenCalledTimes(1);

		// A different content yields a different cache key.
		modelContent = 'import requests\nimport numpy';
		expect(service.getCached(resource)).toBeUndefined();

		await service.ensure(resource);
		expect(listMissingPackages).toHaveBeenCalledTimes(2);
	});

	it('installs a group against its session package manager', async () => {
		const service = createService();

		await service.install({ sessionId, languageId: 'python', packages: [{ name: 'requests' }] });

		expect(instanceInstallPackages).toHaveBeenCalledWith([{ name: 'requests' }], undefined);
	});
});
