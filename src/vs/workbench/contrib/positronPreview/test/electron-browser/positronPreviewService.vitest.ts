/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { PositronPreviewService } from '../../browser/positronPreviewServiceImpl.js';
import { IPositronPreviewService, POSITRON_VIEWER_USE_INTEGRATED_BROWSER, PreviewOpenTarget } from '../../browser/positronPreviewSevice.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { URI } from '../../../../../base/common/uri.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { ElectronPositronPreviewService } from '../../electron-browser/positronPreviewServiceImpl.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { BrowserViewUri } from '../../../../../platform/browserView/common/browserViewUri.js';
import { IUntypedEditorInput } from '../../../../common/editor.js';

describe('Positron - Preview Service', () => {

	const ctx = createTestContainer().withWorkbenchServices().build();
	let previewService: IPositronPreviewService;
	let storageService: IStorageService;

	const STORAGE_KEY = 'positronPreview.defaultOpenTarget';

	beforeEach(() => {
		previewService = ctx.disposables.add(ctx.instantiationService.createInstance(PositronPreviewService));
		storageService = ctx.instantiationService.invokeFunction(accessor => accessor.get(IStorageService));
		storageService.remove(STORAGE_KEY, StorageScope.WORKSPACE);
	});

	it('getDefaultOpenTarget validates stored values and falls back when unrecognized', () => {
		storageService.store(STORAGE_KEY, 'someUnknownValue', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		expect(previewService.getDefaultOpenTarget()).toBe(PreviewOpenTarget.Browser);
	});
});

describe('Positron - Electron Preview Service', () => {

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IBrowserViewWorkbenchService, { createExternalBrowserView: () => new Promise(() => { }) })
		.build();
	let previewService: IPositronPreviewService;
	let configurationService: TestConfigurationService;

	/** Turns the integrated browser setting on or off, as the user would. */
	async function useIntegratedBrowser(value: boolean) {
		await configurationService.setUserConfiguration(POSITRON_VIEWER_USE_INTEGRATED_BROWSER, value);
		configurationService.onDidChangeConfigurationEmitter.fire(stubInterface<IConfigurationChangeEvent>({
			affectsConfiguration: (key: string) => key === POSITRON_VIEWER_USE_INTEGRATED_BROWSER,
		}));
	}

	beforeEach(async () => {
		configurationService = ctx.instantiationService.invokeFunction(accessor => accessor.get(IConfigurationService)) as TestConfigurationService;
		await configurationService.setUserConfiguration(POSITRON_VIEWER_USE_INTEGRATED_BROWSER, false);
		previewService = ctx.disposables.add(ctx.instantiationService.createInstance(ElectronPositronPreviewService));
	});

	it('shows URLs in the backend the setting chooses', async () => {
		const webview = previewService.openUri('previewUrl.a', undefined, URI.parse('http://localhost:8000/'));
		await configurationService.setUserConfiguration(POSITRON_VIEWER_USE_INTEGRATED_BROWSER, true);
		const browser = previewService.openUri('previewUrl.b', undefined, URI.parse('http://localhost:8000/'));

		expect([webview.surface.kind, browser.surface.kind]).toEqual(['webview', 'browser']);
	});

	it('shows the active URL again in the new backend when the setting changes', async () => {
		const before = previewService.openUri('previewUrl.a', undefined, URI.parse('http://localhost:8000/app'));

		await useIntegratedBrowser(true);

		const after = previewService.activePreviewWebview;
		expect({ disposed: before.isDisposed(), kind: after?.surface.kind, address: after?.address?.toString() })
			.toEqual({ disposed: true, kind: 'browser', address: 'http://localhost:8000/app' });
	});

	it('serves an HTML string through the proxy to show it in the integrated browser', async () => {
		await configurationService.setUserConfiguration(POSITRON_VIEWER_USE_INTEGRATED_BROWSER, true);
		const commandService = ctx.instantiationService.invokeFunction(accessor => accessor.get(ICommandService));
		const executeCommand = vi.spyOn(commandService, 'executeCommand').mockResolvedValue('http://localhost:9000/string/abc');

		const preview = await previewService.openHtmlString('quartoHtmlOutput.1', '<h1>Hi</h1>', 'Output - report.qmd');

		expect({
			command: executeCommand.mock.calls[0],
			kind: preview.surface.kind,
			address: preview.address?.toString(),
			active: previewService.activePreviewWebview === preview,
		}).toEqual({
			command: ['positronProxy.startHtmlStringServer', '<h1>Hi</h1>'],
			kind: 'browser',
			address: 'http://localhost:9000/string/abc',
			active: true,
		});
	});

	it('opens Open in Editor Tab in the integrated browser\'s editor when the setting is on', async () => {
		await configurationService.setUserConfiguration(POSITRON_VIEWER_USE_INTEGRATED_BROWSER, true);
		const editorService = ctx.instantiationService.invokeFunction(accessor => accessor.get(IEditorService));
		const openEditor = vi.spyOn(editorService, 'openEditor').mockResolvedValue(undefined);

		await previewService.openEditor(URI.parse('http://localhost:8000/app'));

		const opened = openEditor.mock.calls[0][0] as IUntypedEditorInput & { resource: URI };
		expect({ scheme: opened.resource.scheme, isBrowser: !!BrowserViewUri.getId(opened.resource), viewState: opened.options?.viewState })
			.toEqual({ scheme: BrowserViewUri.scheme, isBrowser: true, viewState: { url: 'http://localhost:8000/app' } });
	});
});
