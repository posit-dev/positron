/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../base/common/event.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { IPositronWebviewPreloadService, NotebookPreloadOutputResults } from '../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { PositronWebviewPreloadService, extractPdfIframeInfo } from './positronWebviewPreloadsService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookOutputWebviewService, INotebookOutputWebview } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IPositronIPyWidgetsService } from '../../../services/positronIPyWidgets/common/positronIPyWidgetsService.js';
import { IPositronNotebookInstance } from '../../positronNotebook/browser/IPositronNotebookInstance.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

/** Minimal stub for IPositronNotebookInstance */
function stubNotebookInstance(id: string, uri = URI.file('/workspace/notebook.ipynb')): IPositronNotebookInstance {
	return stubInterface<IPositronNotebookInstance>({ getId: () => id, uri });
}

/** Counts raw HTML webview creations */
function stubOutputWebviewService(): IPositronNotebookOutputWebviewService & { rawHtmlCreationCount: number; rawHtmlBaseUris: (URI | undefined)[] } {
	let count = 0;
	const rawHtmlBaseUris: (URI | undefined)[] = [];
	return {
		_serviceBrand: undefined,
		get rawHtmlCreationCount() { return count; },
		rawHtmlBaseUris,
		createRawHtmlOutputWebview(id: string, _html: string, baseUri?: URI): Promise<INotebookOutputWebview> {
			count++;
			rawHtmlBaseUris.push(baseUri);
			const onDidRender = new Emitter<void>();
			return Promise.resolve({
				id,
				sessionId: id,
				webview: {} as IOverlayWebview,
				onDidRender: onDidRender.event,
				dispose() { onDidRender.dispose(); },
			});
		},
		createNotebookOutputWebview: () => Promise.resolve(undefined),
		createMultiMessageWebview: () => Promise.resolve(undefined),
	} satisfies IPositronNotebookOutputWebviewService & { rawHtmlCreationCount: number; rawHtmlBaseUris: (URI | undefined)[] };
}

describe('PositronWebviewPreloadService - addNotebookOutput rawHtml', () => {
	const disposables = ensureNoLeakedDisposables();

	let service: IPositronWebviewPreloadService;
	let outputWebviewService: ReturnType<typeof stubOutputWebviewService>;
	const notebookInstance = stubNotebookInstance('nb-1');

	beforeEach(() => {
		outputWebviewService = stubOutputWebviewService();

		const runtimeSessionService = stubInterface<IRuntimeSessionService>({
			activeSessions: [],
			onWillStartSession: Event.None,
		});

		const ipyWidgetsService = stubInterface<IPositronIPyWidgetsService>();

		const commandService = stubInterface<ICommandService>({
			executeCommand: vi.fn().mockResolvedValue(undefined),
		});
		const editorService = stubInterface<IEditorService>({
			openEditor: vi.fn().mockResolvedValue(undefined),
		});

		service = disposables.add(new PositronWebviewPreloadService(
			runtimeSessionService,
			outputWebviewService,
			ipyWidgetsService,
			commandService,
			editorService,
		));

		service.attachNotebookInstance(notebookInstance);
	});

	it('rawHtml parameter creates a raw HTML webview and returns display result', async () => {
		const result = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'out-1',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe>') }],
			rawHtml: '<iframe src="map.html"></iframe>',
		});

		expect(result, 'should return a result').toBeDefined();
		expect(result!.preloadMessageType).toBe('display');
		expect('webview' in result!, 'display result should have a webview').toBe(true);
		expect(outputWebviewService.rawHtmlCreationCount).toBe(1);
		expect(outputWebviewService.rawHtmlBaseUris[0]?.toString()).toBe(URI.file('/workspace').toString());

		// Resolve the webview promise to check the ID; narrow to the 'display' variant of the union.
		const webview = await (result as Extract<NotebookPreloadOutputResults, { preloadMessageType: 'display' }>).webview;
		expect(webview.id).toBe('out-1');
		webview.dispose();
	});

	it('untitled notebooks do not set a base URI for raw HTML', () => {
		const untitledNotebook = stubNotebookInstance('nb-untitled', URI.from({ scheme: 'untitled', path: '/Untitled-1.ipynb' }));
		service.attachNotebookInstance(untitledNotebook);

		const result = service.addNotebookOutput({
			instance: untitledNotebook,
			outputId: 'out-untitled',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe>') }],
			rawHtml: '<iframe src="map.html"></iframe>',
		});

		expect(result, 'should return a result').toBeDefined();
		expect(outputWebviewService.rawHtmlBaseUris[0]).toBe(undefined);
	});

	it('without rawHtml, text/html output returns undefined (not a webview type)', () => {
		const result = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'out-2',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<p>simple</p>') }],
		});

		expect(result, 'plain HTML should not create a webview').toBe(undefined);
		expect(outputWebviewService.rawHtmlCreationCount).toBe(0);
	});
});

describe('PositronWebviewPreloadService - PDF notebook rendering', () => {
	const disposables = ensureNoLeakedDisposables();

	let service: PositronWebviewPreloadService;
	let commandService: ICommandService;
	let editorService: IEditorService;
	let lastWebviewMessageEmitter: Emitter<{ message: unknown }>;
	let renderedHtml: string[];
	const notebookInstance = stubNotebookInstance('nb-pdf');

	beforeEach(() => {
		lastWebviewMessageEmitter = disposables.add(new Emitter<{ message: unknown }>());
		renderedHtml = [];

		const outputWebviewService: IPositronNotebookOutputWebviewService = {
			_serviceBrand: undefined,
			createRawHtmlOutputWebview(id: string, html: string, _baseUri?: URI): Promise<INotebookOutputWebview> {
				renderedHtml.push(html);
				const onDidRender = disposables.add(new Emitter<void>());
				return Promise.resolve({
					id,
					sessionId: id,
					webview: { onMessage: lastWebviewMessageEmitter.event } as unknown as IOverlayWebview,
					onDidRender: onDidRender.event,
					dispose() { onDidRender.dispose(); },
				});
			},
			createNotebookOutputWebview: () => Promise.resolve(undefined),
			createMultiMessageWebview: () => Promise.resolve(undefined),
		};

		const runtimeSessionService = stubInterface<IRuntimeSessionService>({
			activeSessions: [],
			onWillStartSession: Event.None,
		});

		const ipyWidgetsService = stubInterface<IPositronIPyWidgetsService>();

		commandService = stubInterface<ICommandService>({
			executeCommand: vi.fn().mockImplementation((cmd: string, ...args: unknown[]) => {
				if (cmd === 'positron.pdfServer.getViewerUrl') {
					return Promise.resolve({ viewerUrl: 'http://localhost:9999/pdfjs-notebook/web/viewer.html?file=test.pdf', pdfId: 'pdf-123' });
				}
				return Promise.resolve(undefined);
			}),
		});
		editorService = stubInterface<IEditorService>({
			openEditor: vi.fn().mockResolvedValue(undefined),
		});

		service = disposables.add(new PositronWebviewPreloadService(
			runtimeSessionService,
			outputWebviewService,
			ipyWidgetsService,
			commandService,
			editorService,
		));

		service.attachNotebookInstance(notebookInstance);
	});

	it('routes PDF iframe HTML through the PDF server viewer', async () => {
		const result = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'pdf-out-1',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe src="report.pdf">') }],
			rawHtml: '<iframe src="report.pdf" width="800" height="600"></iframe>',
		});

		expect(result).toBeDefined();
		expect(result!.preloadMessageType).toBe('display');

		const webview = await (result as Extract<NotebookPreloadOutputResults, { preloadMessageType: 'display' }>).webview;
		expect(webview.id).toBe('pdf-out-1');
		expect(commandService.executeCommand).toHaveBeenCalledWith('positron.pdfServer.getViewerUrl', '/workspace/report.pdf');
	});

	it('caches the PDF webview on repeated calls for the same output', async () => {
		const result1 = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'pdf-out-cached',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe src="report.pdf">') }],
			rawHtml: '<iframe src="report.pdf" width="800" height="600"></iframe>',
		});

		const result2 = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'pdf-out-cached',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe src="report.pdf">') }],
			rawHtml: '<iframe src="report.pdf" width="800" height="600"></iframe>',
		});

		expect(result1).toBeDefined();
		expect(result2).toBeDefined();

		const webview1 = await (result1 as Extract<NotebookPreloadOutputResults, { preloadMessageType: 'display' }>).webview;
		const webview2 = await (result2 as Extract<NotebookPreloadOutputResults, { preloadMessageType: 'display' }>).webview;
		expect(webview1).toBe(webview2);
	});

	it('opens editor picker when webview posts positron-open-pdf-with message', async () => {
		const result = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'pdf-out-openwith',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe src="report.pdf">') }],
			rawHtml: '<iframe src="report.pdf" width="800" height="600"></iframe>',
		});

		await (result as Extract<NotebookPreloadOutputResults, { preloadMessageType: 'display' }>).webview;

		lastWebviewMessageEmitter.fire({
			message: {
				__vscode_notebook_message: true,
				type: 'positron-open-pdf-with',
				path: '/workspace/report.pdf',
			}
		});

		expect(editorService.openEditor).toHaveBeenCalledWith(
			expect.objectContaining({
				resource: URI.file('/workspace/report.pdf'),
			})
		);
	});

	it('calls unregisterPdf on notebook disposal', async () => {
		const result = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'pdf-out-dispose',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe src="report.pdf">') }],
			rawHtml: '<iframe src="report.pdf" width="800" height="600"></iframe>',
		});

		// Wait for the async webview creation to complete so disposal hooks are registered.
		await (result as Extract<NotebookPreloadOutputResults, { preloadMessageType: 'display' }>).webview;

		// Disposing the service triggers notebook disposable cleanup.
		service.dispose();

		expect(commandService.executeCommand).toHaveBeenCalledWith('positron.pdfServer.unregisterPdf', 'pdf-123');
	});

	it('renders a fallback message when getViewerUrl fails', async () => {
		// Simulate the pdf-server extension being unavailable or the command failing.
		(commandService.executeCommand as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('command failed'));

		const result = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'pdf-out-fallback',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe src="report.pdf">') }],
			rawHtml: '<iframe src="report.pdf" width="800" height="600"></iframe>',
		});

		const webview = await (result as Extract<NotebookPreloadOutputResults, { preloadMessageType: 'display' }>).webview;

		expect(webview.id).toBe('pdf-out-fallback');
		// The fallback webview HTML path is taken: a plain "Unable to render PDF"
		// message rather than the iframe viewer.
		expect(renderedHtml).toEqual(['<p>Unable to render PDF: report.pdf</p>']);
	});
});

describe('extractPdfIframeInfo', () => {
	it('detects an iframe with a .pdf src', () => {
		const html = '<iframe src="report.pdf" width="800" height="600"></iframe>';
		expect(extractPdfIframeInfo(html)).toEqual({ src: 'report.pdf', width: '800', height: '600' });
	});

	it('detects IPython.display.IFrame output (double-quoted, absolute path)', () => {
		const html = '<iframe src="/home/user/output.pdf" width="1000" height="700"></iframe>';
		expect(extractPdfIframeInfo(html)).toEqual({ src: '/home/user/output.pdf', width: '1000', height: '700' });
	});

	it('handles single-quoted attributes', () => {
		const html = `<iframe src='data/plot.pdf' width='600' height='400'></iframe>`;
		expect(extractPdfIframeInfo(html)).toEqual({ src: 'data/plot.pdf', width: '600', height: '400' });
	});

	it('returns src only when width/height are absent', () => {
		const html = '<iframe src="doc.pdf"></iframe>';
		expect(extractPdfIframeInfo(html)).toEqual({ src: 'doc.pdf', width: undefined, height: undefined });
	});

	it('returns undefined for non-PDF iframes', () => {
		expect(extractPdfIframeInfo('<iframe src="map.html"></iframe>')).toBe(undefined);
	});

	it('returns undefined for HTML without iframes', () => {
		expect(extractPdfIframeInfo('<p>hello world</p>')).toBe(undefined);
	});

	it('is case-insensitive on the .pdf extension', () => {
		const html = '<iframe src="REPORT.PDF" width="800" height="600"></iframe>';
		expect(extractPdfIframeInfo(html)).toEqual({ src: 'REPORT.PDF', width: '800', height: '600' });
	});

	it('reads width/height from the PDF iframe, not a sibling iframe', () => {
		// A non-PDF iframe precedes the PDF one with different dimensions; the
		// returned size must come from the matched PDF tag, not the sibling.
		const html = '<iframe src="map.html" width="100" height="200"></iframe>'
			+ '<iframe src="report.pdf" width="800" height="600"></iframe>';
		expect(extractPdfIframeInfo(html)).toEqual({ src: 'report.pdf', width: '800', height: '600' });
	});
});
