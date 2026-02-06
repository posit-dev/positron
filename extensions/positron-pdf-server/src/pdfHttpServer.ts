/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Singleton HTTP server that serves PDF.js library files and individual PDF documents.
 */
export class PdfHttpServer {
	private static instance: PdfHttpServer | undefined;
	private readonly app: express.Express;
	private server: http.Server | undefined;
	private readonly pdfs = new Map<string, string>(); // pdfId -> fsPath
	private serverPort: number = 0;
	private startupPromise: Promise<void> | undefined;

	/**
	 * Private constructor for singleton pattern.
	 */
	private constructor() {
		this.app = express();
		this.setupRoutes();
	}

	/**
	 * Get the singleton instance of the PdfHttpServer.
	 */
	public static getInstance(): PdfHttpServer {
		if (!PdfHttpServer.instance) {
			PdfHttpServer.instance = new PdfHttpServer();
		}
		return PdfHttpServer.instance;
	}

	/**
	 * Setup Express routes.
	 */
	private setupRoutes(): void {
		// Serve PDF.js distribution files statically (includes web/viewer.html, build/, etc.).
		this.app.use('/pdfjs', express.static(
			path.join(__dirname, '../pdfjs-dist')
		));

		// Serve individual PDFs with unique IDs.
		this.app.get('/pdf/:pdfId', async (req, res) => {
			try {
				const pdfPath = this.pdfs.get(req.params.pdfId);
				if (!pdfPath) {
					return res.status(404).send('PDF not found');
				}

				// Check if file exists.
				if (!fs.existsSync(pdfPath)) {
					this.pdfs.delete(req.params.pdfId);
					return res.status(404).send('PDF file no longer exists');
				}

				// Read and serve PDF file.
				const pdfData = await fs.promises.readFile(pdfPath);
				res.contentType('application/pdf');
				return res.send(pdfData);
			} catch (err) {
				console.error('Error serving PDF:', err);
				return res.status(500).send('Error reading PDF file');
			}
		});

		// Serve custom viewer HTML.
		this.app.get('/viewer', (_req, res) => {
			res.send(this.generateViewerHtml());
		});
	}

	/**
	 * Start the HTTP server.
	 */
	private async startServer(): Promise<void> {
		if (this.startupPromise) {
			return this.startupPromise;
		}

		this.startupPromise = new Promise<void>((resolve, reject) => {
			try {
				this.server = this.app.listen(0, 'localhost', () => {
					const address = this.server!.address();
					if (!address || typeof address === 'string') {
						reject(new Error('Failed to get server address'));
						return;
					}
					this.serverPort = address.port;
					console.log(`PDF server started on port ${this.serverPort}`);
					resolve();
				});

				this.server.on('error', (err) => {
					reject(new Error(`Server error: ${err.message}`));
				});

				// Timeout after 5 seconds.
				setTimeout(() => {
					if (this.serverPort === 0) {
						reject(new Error('Server startup timeout'));
					}
				}, 5000);
			} catch (err) {
				reject(err);
			}
		});

		return this.startupPromise;
	}

	/**
	 * Get the server URL with remote compatibility.
	 */
	public async getExternalUrl(): Promise<string> {
		// Ensure server is started.
		await this.startServer();

		const localUrl = `http://localhost:${this.serverPort}`;
		console.log(`Local URL: ${localUrl}`);
		const uri = vscode.Uri.parse(localUrl);
		const externalUri = await vscode.env.asExternalUri(uri);
		console.log(`External URL: ${externalUri.toString()}`);
		return externalUri.toString();
	}

	/**
	 * Register a PDF document with the server.
	 */
	public registerPdf(pdfUri: vscode.Uri): string {
		// Generate unique 8-character hex ID.
		const pdfId = Math.random().toString(16).substring(2, 10);
		this.pdfs.set(pdfId, pdfUri.fsPath);
		console.log(`Registered PDF ${pdfId}: ${pdfUri.fsPath}`);
		return pdfId;
	}

	/**
	 * Unregister a PDF document from the server.
	 */
	public unregisterPdf(pdfId: string): void {
		if (this.pdfs.delete(pdfId)) {
			console.log(`Unregistered PDF ${pdfId}`);
		}
	}

	/**
	 * Generate the PDF viewer HTML.
	 */
	private generateViewerHtml(): string {
		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>PDF Viewer</title>
	<style>
		body {
			margin: 0;
			padding: 0;
			background: #525252;
			font-family: system-ui, -apple-system, sans-serif;
		}
		#toolbar {
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
			font-size: 13px;
		}
		button:hover:not(:disabled) {
			background: #606060;
		}
		button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		#pageInfo {
			color: #ccc;
			font-size: 13px;
			margin-left: 8px;
		}
		#viewerContainer {
			position: absolute;
			top: 41px;
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
	<div id="toolbar">
		<button id="zoomOut">-</button>
		<button id="zoomIn">+</button>
		<span id="pageInfo"></span>
		<button id="prevPage">Previous</button>
		<button id="nextPage">Next</button>
	</div>
	<div id="viewerContainer"></div>

	<script type="module">
		import * as pdfjsLib from '/pdfjs/legacy/build/pdf.mjs';

		pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/legacy/build/pdf.worker.mjs';

		const params = new URLSearchParams(window.location.search);
		const pdfUrl = params.get('file');

		const container = document.getElementById('viewerContainer');
		let pdfDoc = null;
		let currentScale = 1.5;
		let currentPage = 1;
		let canvases = [];

		// Fetch and load PDF.
		pdfjsLib.getDocument(pdfUrl).promise.then(async pdf => {
			console.log('PDF loaded, pages:', pdf.numPages);
			pdfDoc = pdf;
			await renderAllPages();
			updatePageInfo();
		}).catch(err => {
			console.error('Failed to load PDF:', err);
			container.innerHTML = '<div style="color:white;padding:20px">Error loading PDF: ' + err.message + '</div>';
		});

		async function renderAllPages() {
			container.innerHTML = '';
			canvases = [];

			for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
				const page = await pdfDoc.getPage(pageNum);
				const viewport = page.getViewport({ scale: currentScale });

				const canvas = document.createElement('canvas');
				canvas.className = 'page';

				// High DPI support.
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

		// Zoom controls.
		document.getElementById('zoomIn').addEventListener('click', async () => {
			currentScale *= 1.2;
			await renderAllPages();
		});

		document.getElementById('zoomOut').addEventListener('click', async () => {
			currentScale /= 1.2;
			await renderAllPages();
		});

		// Page navigation.
		document.getElementById('prevPage').addEventListener('click', () => {
			if (currentPage > 1) {
				currentPage--;
				scrollToPage(currentPage);
			}
		});

		document.getElementById('nextPage').addEventListener('click', () => {
			if (currentPage < pdfDoc.numPages) {
				currentPage++;
				scrollToPage(currentPage);
			}
		});

		function scrollToPage(pageNum) {
			const canvas = canvases[pageNum - 1];
			if (canvas) {
				canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
				updatePageInfo();
			}
		}

		function updatePageInfo() {
			const pageInfo = document.getElementById('pageInfo');
			const prevBtn = document.getElementById('prevPage');
			const nextBtn = document.getElementById('nextPage');

			if (pdfDoc) {
				pageInfo.textContent = \`Page \${currentPage} of \${pdfDoc.numPages}\`;
				prevBtn.disabled = currentPage === 1;
				nextBtn.disabled = currentPage === pdfDoc.numPages;
			}
		}

		// Track scroll position for page info.
		container.addEventListener('scroll', () => {
			const containerTop = container.scrollTop + 50;
			for (let i = 0; i < canvases.length; i++) {
				const canvas = canvases[i];
				if (canvas.offsetTop <= containerTop && canvas.offsetTop + canvas.offsetHeight > containerTop) {
					currentPage = i + 1;
					updatePageInfo();
					break;
				}
			}
		});
	</script>
</body>
</html>`;
	}

	/**
	 * Dispose the server.
	 */
	public static dispose(): void {
		if (PdfHttpServer.instance) {
			if (PdfHttpServer.instance.server) {
				PdfHttpServer.instance.server.close();
				console.log('PDF server stopped');
			}
			PdfHttpServer.instance = undefined;
		}
	}
}
