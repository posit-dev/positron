/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Generates a nonce for CSP.
 */
function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/**
 * PDF Preview Provider implementing a custom readonly editor for PDF files.
 */
export class PdfPreviewProvider implements vscode.CustomReadonlyEditorProvider {
	// The custom editor view type.
	public static readonly viewType = 'pdfViewer.previewEditor';

	/**
	 * Constructor.
	 * @param extensionUri The extension URI.
	 */
	constructor(private readonly extensionUri: vscode.Uri) {
	}

	/**
	 * Registers the PDF Preview Provider.
	 * @param context The extension context.
	 * @returns A disposable to unregister the provider.
	 */
	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		// Create the provider.
		const provider = new PdfPreviewProvider(context.extensionUri);

		// Register the custom editor provider.
		return vscode.window.registerCustomEditorProvider(PdfPreviewProvider.viewType, provider, {
			supportsMultipleEditorsPerDocument: true,
			webviewOptions: {
				retainContextWhenHidden: true,
			}
		});
	}

	/**
	 * Opens a custom document.
	 * @param uri The document URI.
	 * @returns A Promise resolving to the custom document.
	 */
	public async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
		return {
			uri,
			dispose: () => { }
		};
	}

	/**
	 * Resolves the custom editor for the PDF document.
	 * @param document The custom document.
	 * @param webviewPanel The webview panel.
	 * @param _token A cancellation token.
	 */
	public async resolveCustomEditor(
		document: vscode.CustomDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		const webview = webviewPanel.webview;

		// Allow scripts and access to the bundled PDF.js viewer.
		webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this.extensionUri,
			]
		};

		// Read the PDF file and encode as data URL.
		const pdfData = await vscode.workspace.fs.readFile(document.uri);
		const base64Data = Buffer.from(pdfData).toString('base64');

		// Get URI for PDF.js library (using legacy build for Electron compatibility).
		const pdfJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'pdfjs', 'legacy', 'build', 'pdf.mjs'));

		// Create our own simple viewer HTML.
		webview.html = this.createViewerHtml(webview, pdfJsUri, base64Data);
	}

	private createViewerHtml(
		webview: vscode.Webview,
		pdfJsUri: vscode.Uri,
		base64PdfData: string
	): string {
		const cspSource = webview.cspSource;
		const nonce = getNonce();

		return /* html */`<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource} 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:; worker-src ${cspSource} blob:;">
	<title>PDF Viewer</title>
	<style>
		body {
			margin: 0;
			padding: 0;
			background: #525252;
		}
		#toolbar {
			display: none;
			background: #323639;
			padding: 8px;
			display: flex;
			align-items: center;
			gap: 8px;
			border-bottom: 1px solid #1a1a1a;
		}
		button {
			background: #505050;
			color: white;
			border: none;
			padding: 6px 12px;
			cursor: pointer;
			border-radius: 3px;
		}
		button:hover {
			background: #606060;
		}
		button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		#pageInfo {
			color: #ccc;
			font-size: 13px;
		}
		#viewerContainer {
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			overflow: auto;
			display: flex;
			flex-direction: column;
			align-items: center;
			padding: 20px;
		}
		.page {
			margin-bottom: 10px;
			box-shadow: 0 2px 8px rgba(0,0,0,0.3);
			background: white;
		}
	</style>
</head>
<body>
	<div id="viewerContainer"></div>
	<script type="module" nonce="${nonce}">
		import * as pdfjsLib from '${pdfJsUri}';

		pdfjsLib.GlobalWorkerOptions.workerSrc = '${pdfJsUri}'.replace('pdf.mjs', 'pdf.worker.mjs');

		const base64 = '${base64PdfData}';
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}

		const container = document.getElementById('viewerContainer');
		let pdfDoc = null;
		let currentScale = 1.5;
		let currentPage = 1;
		let canvases = [];

		pdfjsLib.getDocument({ data: bytes }).promise.then(async pdf => {
			console.log('PDF loaded, pages:', pdf.numPages);
			pdfDoc = pdf;
			await renderAllPages();
		}).catch(err => {
			console.error('Failed to load PDF:', err);
			document.body.innerHTML = '<div style="color:white;padding:20px">Error loading PDF: ' + err.message + '</div>';
		});

		async function renderAllPages() {
			container.innerHTML = '';
			canvases = [];

			for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
				const page = await pdfDoc.getPage(pageNum);
				const viewport = page.getViewport({ scale: currentScale });

				const canvas = document.createElement('canvas');
				canvas.className = 'page';

				const outputScale = window.devicePixelRatio || 1;
				canvas.width = Math.floor(viewport.width * outputScale);
				canvas.height = Math.floor(viewport.height * outputScale);
				canvas.style.width = Math.floor(viewport.width) + 'px';
				canvas.style.height = Math.floor(viewport.height) + 'px';

				canvas.dataset.pageNum = pageNum;

				container.appendChild(canvas);
				canvases.push(canvas);

				const context = canvas.getContext('2d');
				const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
				await page.render({
					canvasContext: context,
					viewport: viewport,
					transform: transform
				}).promise;
			}
		}
	</script>
</body>
</html>`;
	}
}
