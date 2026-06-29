/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronPackagesService } from '../../../positronPackages/browser/interfaces/positronPackagesService.js';
import { IPositronPackagesInstance } from '../../../positronPackages/browser/positronPackagesInstance.js';
import { ILanguageRuntimePackageManager, ILanguageRuntimeSession, INotebookLanguageRuntimeSession, IRuntimeMissingPackage, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { IQuartoDocumentModelService } from '../../../positronQuarto/browser/quartoDocumentModelService.js';
import { POSITRON_QUARTO_INLINE_OUTPUT_KEY } from '../../../positronQuarto/common/positronQuartoConfig.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../../../positronQuarto/common/quartoTypes.js';
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
	const onDidChangeForegroundSession = new Emitter<string | undefined>();

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

	// Notebook fixtures: a notebook resource analyzed by its kernel session
	// (not the foreground console session). The model carries one Python code
	// cell and one markup cell; only the code cell should be analyzed.
	const notebookResource = URI.file('/workspace/foo.ipynb');
	const notebookSessionId = 'python-notebook-1';
	const notebookListMissingPackages = vi.fn<(...args: unknown[]) => Promise<IRuntimeMissingPackage[]>>()
		.mockResolvedValue([{ name: 'plotnine' }]);
	const notebookSession = stubInterface<INotebookLanguageRuntimeSession>({
		sessionId: notebookSessionId,
		runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId: 'python' }),
		listMissingPackages: notebookListMissingPackages,
		getPackageManager: () => packageManager,
	});
	const notebookModel = stubInterface<NotebookTextModel>({
		cells: [
			stubInterface<NotebookCellTextModel>({ cellKind: CellKind.Code, language: 'python', getValue: () => 'import plotnine' }),
			stubInterface<NotebookCellTextModel>({ cellKind: CellKind.Markup, language: 'markdown', getValue: () => '# heading' }),
		],
	});

	// Quarto fixtures: a .qmd document split into per-language code chunks, each
	// routed to that language's console session. The R chunk goes to the R
	// console session; the Python chunk reuses the Python console session above.
	const quartoResource = URI.file('/workspace/notebook.qmd');
	const rSessionId = 'r-session-1';
	const rListMissingPackages = vi.fn<(...args: unknown[]) => Promise<IRuntimeMissingPackage[]>>()
		.mockResolvedValue([{ name: 'leaflet' }]);
	const rSession = stubInterface<ILanguageRuntimeSession>({
		sessionId: rSessionId,
		listMissingPackages: rListMissingPackages,
		getPackageManager: () => packageManager,
	});
	const quartoModel = stubInterface<IQuartoDocumentModel>({
		cells: [
			stubInterface<QuartoCodeCell>({ language: 'r' }),
			stubInterface<QuartoCodeCell>({ language: 'python' }),
		],
		getCellCode: (cell: QuartoCodeCell) => (cell.language === 'r' ? 'library(leaflet)' : 'import requests'),
	});

	// With inline output, the .qmd runs in its own per-document (notebook-mode)
	// session keyed by the document URI, rather than the shared console sessions.
	const quartoInlineSessionId = 'quarto-inline-1';
	const quartoInlineListMissingPackages = vi.fn<(...args: unknown[]) => Promise<IRuntimeMissingPackage[]>>()
		.mockResolvedValue([{ name: 'leaflet' }]);
	const quartoInlineSession = stubInterface<INotebookLanguageRuntimeSession>({
		sessionId: quartoInlineSessionId,
		runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId: 'r' }),
		listMissingPackages: quartoInlineListMissingPackages,
		getPackageManager: () => packageManager,
	});

	// Drives `usingQuartoInlineOutput`; flipped per test.
	let quartoInlineOutputEnabled = false;

	const ctx = createTestContainer()
		.stub(IRuntimeSessionService, {
			onWillStartSession: Event.None,
			onDidChangeForegroundSession: onDidChangeForegroundSession.event,
			onDidDeleteRuntimeSession: onDidDeleteRuntimeSession.event,
			getConsoleSessionForLanguage: (languageId: string) => {
				if (languageId === 'python') { return session; }
				if (languageId === 'r') { return rSession; }
				return undefined;
			},
			getNotebookSessionForNotebookUri: (uri: URI) => {
				if (uri.toString() === notebookResource.toString()) { return notebookSession; }
				if (uri.toString() === quartoResource.toString()) { return quartoInlineSession; }
				return undefined;
			},
			getSession: (id: string) => {
				if (id === sessionId) { return session; }
				if (id === notebookSessionId) { return notebookSession; }
				if (id === rSessionId) { return rSession; }
				if (id === quartoInlineSessionId) { return quartoInlineSession; }
				return undefined;
			},
		})
		.stub(IPositronPackagesService, {
			onDidChangeActivePackagesInstance: Event.None,
			getInstances: () => [packagesInstance],
		})
		.stub(IModelService, {
			getModel: (uri: URI) => (modelContent === null
				? null
				: stubInterface<ITextModel>({ uri, getLanguageId: () => modelLanguageId, getValue: () => modelContent! })),
		})
		.stub(ITextModelService, {})
		.stub(INotebookService, {
			getNotebookTextModel: (uri: URI) => (uri.toString() === notebookResource.toString() ? notebookModel : undefined),
		})
		.stub(IQuartoDocumentModelService, {
			getModel: () => quartoModel,
		})
		.stub(IConfigurationService, {
			getValue: (key?: unknown) => (key === POSITRON_QUARTO_INLINE_OUTPUT_KEY ? quartoInlineOutputEnabled : undefined),
		})
		.stub(ILogService, new NullLogService())
		.build();

	function createService(): IMissingPackagesService {
		return ctx.disposables.add(ctx.instantiationService.createInstance(MissingPackagesService));
	}

	beforeEach(() => {
		modelLanguageId = 'python';
		modelContent = 'import requests';
		quartoInlineOutputEnabled = false;
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

	it('keeps cached results on a foreground-session change, notifying without re-analyzing', async () => {
		const service = createService();
		await service.ensure(resource);
		expect(listMissingPackages).toHaveBeenCalledTimes(1);

		const changed: URI[] = [];
		ctx.disposables.add(service.onDidChangeMissingPackages(uri => changed.push(uri)));

		onDidChangeForegroundSession.fire('some-other-session');

		// The resource is notified to re-resolve, but its cached per-session
		// result survives -- flipping sessions must not re-run the analyzer.
		expect(changed.map(uri => uri.toString())).toEqual([resource.toString()]);
		expect(service.getCached(resource)?.total).toBe(1);
		expect(listMissingPackages).toHaveBeenCalledTimes(1);
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

	it('tracks installing state across installAll and clears it when done', async () => {
		const service = createService();
		const result = await service.ensure(resource);

		const changed: URI[] = [];
		ctx.disposables.add(service.onDidChangeInstalling(uri => changed.push(uri)));

		// Hold the install open so the in-progress state can be observed.
		let resolveInstall!: () => void;
		instanceInstallPackages.mockReturnValueOnce(new Promise<void>(resolve => { resolveInstall = resolve; }));

		const installPromise = service.installAll(result);
		expect(service.getInstalling(resource)).toBe(result);

		resolveInstall();
		await installPromise;
		expect(service.getInstalling(resource)).toBeUndefined();

		// One fire on start, one on finish.
		expect(changed.map(uri => uri.toString())).toEqual([resource.toString(), resource.toString()]);
	});

	it('analyzes a notebook via its kernel session, sending only code cells', async () => {
		const service = createService();

		const result = await service.ensure(notebookResource);

		expect({ ...result, resource: result.resource.toString() }).toMatchInlineSnapshot(`
			{
			  "groups": [
			    {
			      "languageId": "python",
			      "packages": [
			        {
			          "name": "plotnine",
			        },
			      ],
			      "sessionId": "python-notebook-1",
			    },
			  ],
			  "resource": "file:///workspace/foo.ipynb",
			  "total": 1,
			}
		`);
		// The markup cell is excluded; only the code cell's source is analyzed.
		expect(notebookListMissingPackages).toHaveBeenCalledWith({ code: 'import plotnine' }, expect.anything());
	});

	it('analyzes a console-mode quarto document per language, routing each chunk to its console session', async () => {
		modelLanguageId = 'quarto';
		modelContent = '```{r}\nlibrary(leaflet)\n```\n```{python}\nimport requests\n```';
		const service = createService();

		const result = await service.ensure(quartoResource);

		expect({ ...result, resource: result.resource.toString() }).toMatchInlineSnapshot(`
			{
			  "groups": [
			    {
			      "languageId": "r",
			      "packages": [
			        {
			          "name": "leaflet",
			        },
			      ],
			      "sessionId": "r-session-1",
			    },
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
			  "resource": "file:///workspace/notebook.qmd",
			  "total": 2,
			}
		`);
		// Each language's chunk is sent to its own console session.
		expect(rListMissingPackages).toHaveBeenCalledWith({ code: 'library(leaflet)' }, expect.anything());
		expect(listMissingPackages).toHaveBeenCalledWith({ code: 'import requests' }, expect.anything());
	});

	it('analyzes an inline-output quarto document via its per-document session', async () => {
		quartoInlineOutputEnabled = true;
		modelLanguageId = 'quarto';
		modelContent = '```{r}\nlibrary(leaflet)\n```\n```{python}\nimport requests\n```';
		const service = createService();

		const result = await service.ensure(quartoResource);

		// Only the document session's language (r) is analyzed, and it is sent to
		// the per-document session rather than the shared console sessions.
		expect({ ...result, resource: result.resource.toString() }).toMatchInlineSnapshot(`
			{
			  "groups": [
			    {
			      "languageId": "r",
			      "packages": [
			        {
			          "name": "leaflet",
			        },
			      ],
			      "sessionId": "quarto-inline-1",
			    },
			  ],
			  "resource": "file:///workspace/notebook.qmd",
			  "total": 1,
			}
		`);
		expect(quartoInlineListMissingPackages).toHaveBeenCalledWith({ code: 'library(leaflet)' }, expect.anything());
		// The shared console sessions are not consulted in inline-output mode.
		expect(rListMissingPackages).not.toHaveBeenCalled();
	});
});
