/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess, nodeModulesPath } from '../../../../base/common/network.js';
import { joinPath } from '../../../../base/common/resources.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IWebviewService, IOverlayWebview } from '../../webview/browser/webview.js';
import { MermaidRenderService } from './mermaidRenderServiceImpl.js';
import { MermaidTheme } from './mermaidRenderService.js';
import { asWebviewUri, webviewGenericCspSource } from '../../webview/common/webview.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';

interface RenderRequest {
	id: string;
	source: string;
	theme: MermaidTheme;
	deferred: DeferredPromise<string>;
}

interface RenderResponseMessage {
	type: 'rendered';
	id: string;
	svg: string;
}

interface RenderErrorMessage {
	type: 'renderError';
	id: string;
	message: string;
}

interface ReadyMessage {
	type: 'ready';
}

type WebviewMessage = RenderResponseMessage | RenderErrorMessage | ReadyMessage;

function isWebviewMessage(msg: unknown): msg is WebviewMessage {
	return typeof msg === 'object' && msg !== null && 'type' in msg;
}

/**
 * Renders mermaid diagrams in a single shared offscreen webview.
 *
 * Mermaid renders by mutating the DOM with innerHTML, which the workbench
 * document forbids under its Trusted Types CSP. The webview gives mermaid its
 * own document (free of that restriction) and posts back a sanitized SVG
 * string, which callers inject into the workbench document. One webview is
 * shared across all diagrams; the base class caches and dedups by source+theme.
 */
export class MermaidWebviewRenderService extends MermaidRenderService {

	private _webview: IOverlayWebview | undefined;
	private _hiddenElement: HTMLDivElement | undefined;
	private _ready: DeferredPromise<void> | undefined;
	private readonly _pendingRequests = new Map<string, RenderRequest>();

	// Disposables tied to the current webview instance. Reset on each
	// (re)creation so a webview disposed externally and rebuilt later does not
	// stack listeners on the service store.
	private readonly _webviewDisposables = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	private static readonly REQUEST_TIMEOUT_MS = 30_000;

	protected override doRender(source: string, theme: MermaidTheme): Promise<string> {
		if (this._store.isDisposed) {
			return Promise.reject(new Error('Service disposed'));
		}

		this._ensureWebview();

		const id = generateUuid();
		const deferred = new DeferredPromise<string>();
		const request: RenderRequest = { id, source, theme, deferred };
		this._pendingRequests.set(id, request);

		const timeout = setTimeout(() => {
			if (this._pendingRequests.delete(id)) {
				deferred.error(new Error('Mermaid render timed out'));
			}
		}, MermaidWebviewRenderService.REQUEST_TIMEOUT_MS);

		deferred.p.finally(() => clearTimeout(timeout));

		this._logService.debug('[MermaidRenderService] Queuing render request', id);

		this._ready!.p.then(
			() => {
				if (!this._pendingRequests.has(id)) {
					return;
				}
				this._logService.debug('[MermaidRenderService] Posting render message', id);
				this._webview!.postMessage({ type: 'render', id, source, theme });
			},
			(err) => {
				if (this._pendingRequests.delete(id)) {
					deferred.error(err);
				}
			}
		);

		return deferred.p;
	}

	private _ensureWebview(): void {
		if (this._webview) {
			return;
		}

		this._logService.debug('[MermaidRenderService] Creating offscreen webview');
		this._ready = new DeferredPromise<void>();
		const disposables = this._webviewDisposables.value = new DisposableStore();

		const mermaidRoot = joinPath(FileAccess.asFileUri(nodeModulesPath), 'mermaid', 'dist');

		this._webview = this._webviewService.createWebviewOverlay({
			origin: DOM.getActiveWindow().origin,
			contentOptions: {
				allowScripts: true,
				allowMultipleAPIAcquire: true,
				localResourceRoots: [mermaidRoot],
			},
			extension: undefined,
			options: {
				retainContextWhenHidden: true,
			},
			title: 'Mermaid Renderer',
		});

		disposables.add(this._webview);
		disposables.add(this._webview.onDidDispose(() => {
			this._webview = undefined;
			this._ready = undefined;
			this._removeHiddenElement();
		}));

		const targetWindow = DOM.getActiveWindow();
		this._hiddenElement = targetWindow.document.createElement('div');
		this._hiddenElement.style.position = 'absolute';
		this._hiddenElement.style.left = '-9999px';
		this._hiddenElement.style.top = '-9999px';
		this._hiddenElement.style.width = '1024px';
		this._hiddenElement.style.height = '768px';
		this._hiddenElement.style.overflow = 'hidden';
		this._hiddenElement.style.pointerEvents = 'none';
		targetWindow.document.body.appendChild(this._hiddenElement);

		this._webview.claim(this, DOM.getActiveWindow(), this._contextKeyService);
		this._webview.setAnchorElement(this._hiddenElement);

		disposables.add(this._webview.onMessage(e => {
			const msg = e.message;
			if (!isWebviewMessage(msg)) {
				return;
			}
			this._logService.debug('[MermaidRenderService] Received message:', msg.type, msg.type === 'ready' ? '' : msg.id);

			switch (msg.type) {
				case 'ready':
					this._logService.debug('[MermaidRenderService] Webview ready');
					this._ready!.complete(undefined);
					break;
				case 'rendered': {
					this._logService.debug('[MermaidRenderService] Render complete for', msg.id);
					const request = this._pendingRequests.get(msg.id);
					if (request) {
						this._pendingRequests.delete(msg.id);
						request.deferred.complete(msg.svg);
					}
					break;
				}
				case 'renderError': {
					this._logService.debug('[MermaidRenderService] Render error for', msg.id, msg.message);
					const request = this._pendingRequests.get(msg.id);
					if (request) {
						this._pendingRequests.delete(msg.id);
						request.deferred.error(new Error(msg.message));
					}
					break;
				}
			}
		}));

		const mermaidScriptUri = asWebviewUri(joinPath(mermaidRoot, 'mermaid.min.js'));
		this._webview.setHtml(this._getWebviewHtml(mermaidScriptUri.toString(true)));

		const readyTimeout = setTimeout(() => {
			if (!this._ready!.isSettled) {
				this._logService.error('[MermaidRenderService] Webview failed to become ready within timeout');
				this._ready!.error(new Error('Mermaid webview failed to initialize'));
			}
		}, MermaidWebviewRenderService.REQUEST_TIMEOUT_MS);

		this._ready.p.finally(() => clearTimeout(readyTimeout));
	}

	private _removeHiddenElement(): void {
		this._hiddenElement?.remove();
		this._hiddenElement = undefined;
	}

	private _getWebviewHtml(mermaidScriptSrc: string): string {
		const nonce = generateUuid();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webviewGenericCspSource} 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:;">
</head>
<body>
	<script nonce="${nonce}" src="${mermaidScriptSrc}"></script>
	<script nonce="${nonce}">
		(function() {
			const vscode = acquireVsCodeApi();
			let currentTheme = 'default';

			const mermaid = globalThis.mermaid;
			if (!mermaid) {
				return;
			}
			mermaid.initialize({ startOnLoad: false, theme: currentTheme, securityLevel: 'strict' });

			window.addEventListener('message', async (event) => {
				const msg = event.data;
				if (!msg || msg.type !== 'render') {
					return;
				}

				if (msg.theme !== currentTheme) {
					currentTheme = msg.theme;
					mermaid.initialize({ startOnLoad: false, theme: currentTheme, securityLevel: 'strict' });
				}

				try {
					const { svg } = await mermaid.render('mermaid-' + msg.id, msg.source);

					// Defense-in-depth: strip executable content before posting back.
					// Mermaid's securityLevel:'strict' already handles this, but this
					// guards against upstream regressions.
					const safeHref = /^\\s*(https?:|#|$)/i;
					const div = document.createElement('div');
					div.innerHTML = svg;
					for (const s of div.querySelectorAll('script')) { s.remove(); }
					for (const el of div.querySelectorAll('*')) {
						for (const attr of [...el.attributes]) {
							if (attr.name.startsWith('on')) { el.removeAttribute(attr.name); }
						}
						if (!safeHref.test(el.getAttribute('href') || '')) { el.removeAttribute('href'); }
						if (!safeHref.test(el.getAttribute('xlink:href') || '')) { el.removeAttribute('xlink:href'); }
					}
					const sanitizedSvg = div.innerHTML;

					vscode.postMessage({ type: 'rendered', id: msg.id, svg: sanitizedSvg });
				} catch (err) {
					const message = err && typeof err === 'object' && 'message' in err
						? err.message
						: String(err);
					vscode.postMessage({ type: 'renderError', id: msg.id, message: message });
				}
			});

			vscode.postMessage({ type: 'ready' });
		})();
	</script>
</body>
</html>`;
	}

	override dispose(): void {
		if (this._ready && !this._ready.isSettled) {
			this._ready.error(new Error('Service disposed'));
		}

		for (const request of this._pendingRequests.values()) {
			request.deferred.error(new Error('Service disposed'));
		}
		this._pendingRequests.clear();

		this._removeHiddenElement();

		super.dispose();
	}
}
