/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Singleton HTTP server that serves PDF.js library files and individual PDF documents.
 */
export class PdfHttpServer {
	// PdfHttpServer singleton instance.
	private static instance: PdfHttpServer | undefined;

	// The Express app.
	private readonly app: express.Express;

	// The HTTP server instance.
	private server: http.Server | undefined;

	// Map of PDF IDs to file system paths.
	private readonly pdfs = new Map<string, string>(); // pdfId -> fsPath

	// Port the server is listening on (assigned dynamically).
	private serverPort: number = 0;

	// Server startup promise to ensure we only start once.
	private startupPromise: Promise<void> | undefined;

	// Extension path for serving static files.
	private extensionPath: string | undefined;

	/**
	 * Private constructor for singleton pattern.
	 */
	private constructor() {
		// Create Express app.
		this.app = express();
	}

	/**
	 * Get the singleton instance of the PdfHttpServer.
	 */
	public static getInstance(): PdfHttpServer {
		// Create the singleton instance if it doesn't exist.
		if (!PdfHttpServer.instance) {
			PdfHttpServer.instance = new PdfHttpServer();
		}

		// Return the singleton instance.
		return PdfHttpServer.instance;
	}

	/**
	 * Initialize the server with the extension path.
	 * Must be called before using the server.
	 */
	public initialize(extensionPath: string): void {
		// Only initialize routes once, even if initialize() is called multiple times.
		if (!this.extensionPath) {
			this.extensionPath = extensionPath;
			this.setupRoutes();
		}
	}

	/**
	 * Replace the first occurrence of an anchor in viewer.html, warning if the
	 * anchor is absent.
	 *
	 * The notebook viewer is assembled by string/regex surgery on pdf.js's
	 * stock viewer.html. These anchors (the `<title>`, `</head>`, and the
	 * `#secondaryOpenFile` button) are coupled to the bundled pdf.js version
	 * (see pdfjs-dist in package.json). A pdf.js upgrade that renames or removes
	 * one of them would make String.replace a silent no-op; logging here surfaces
	 * the breakage instead of shipping a viewer that is missing its injections.
	 */
	private replaceAnchor(html: string, anchor: string | RegExp, replacement: string): string {
		const found = typeof anchor === 'string' ? html.includes(anchor) : anchor.test(html);
		if (!found) {
			console.warn(`PDF viewer injection anchor not found (pdf.js version mismatch?): ${anchor}`);
			return html;
		}
		return html.replace(anchor, replacement);
	}

	/**
	 * Read viewer.html from disk and inject the keyboard forwarder script.
	 */
	private async readBaseViewerHtml(): Promise<string> {
		const viewerPath = path.join(this.extensionPath!, 'pdfjs-dist', 'web', 'viewer.html');
		let html = await fs.promises.readFile(viewerPath, 'utf-8');
		const scriptTag = '<script src="/keyboard-forwarder.js"></script>';
		html = this.replaceAnchor(html, '<title>PDF.js viewer</title>', `<title>PDF.js viewer</title>\n${scriptTag}`);
		return html;
	}

	/**
	 * Setup Express routes.
	 */
	private setupRoutes(): void {
		// Ensure extension path is set before setting up routes.
		if (!this.extensionPath) {
			throw new Error('Server not initialized. Call initialize() with extension path first.');
		}

		// Serve PDF.js viewer.html with keyboard forwarder script injected.
		this.app.get('/pdfjs/web/viewer.html', async (req: express.Request, res: express.Response) => {
			try {
				const html = await this.readBaseViewerHtml();
				res.type('text/html');
				return res.send(html);
			} catch (err) {
				console.error('Error serving modified viewer.html:', err);
				return res.status(500).send('Error loading PDF viewer');
			}
		});

		// Serve PDF.js distribution files statically (includes web/*, build/*, etc.).
		this.app.use('/pdfjs', express.static(
			path.join(this.extensionPath, 'pdfjs-dist')
		));

		// Serve keyboard forwarder script for injection into PDF.js viewer.
		this.app.get('/keyboard-forwarder.js', (_req: express.Request, res: express.Response) => {
			res.type('application/javascript');
			res.sendFile(path.join(this.extensionPath!, 'keyboard-forwarder.js'));
		});

		// Serve custom viewer wrapper.
		this.app.get('/viewer', (_req: express.Request, res: express.Response) => {
			res.sendFile(path.join(this.extensionPath!, 'viewer-wrapper.html'));
		});

		// Serve notebook variant of viewer.html with theme preferences and
		// "Open With..." button injected. Called directly (no wrapper redirect).
		this.app.get('/pdfjs-notebook/web/viewer.html', async (req: express.Request, res: express.Response) => {
			try {
				let html = await this.readBaseViewerHtml();

				// Set theme via pdf.js's webviewerloaded event, which fires after
				// the viewer is constructed but before it reads preferences.
				const theme = req.query.theme || '0';
				const themeScript = `<script>
					document.addEventListener('webviewerloaded', function() {
						PDFViewerApplicationOptions.set('viewerCssTheme', ${Number(theme)});
						PDFViewerApplicationOptions.set('sidebarViewOnLoad', 0);
					});
				</script>`;
				html = this.replaceAnchor(html, '<title>PDF.js viewer</title>', `<title>PDF.js viewer</title>\n${themeScript}`);

				// Inject CSS for the "Open With..." button icon (reuses the Open button's icon).
				const openWithCss = `<style>
					:is(#secondaryToolbar #secondaryToolbarButtonContainer) #notebookOpenWith::before {
						-webkit-mask-image: url("images/toolbarButton-openFile.svg");
						mask-image: url("images/toolbarButton-openFile.svg");
					}
				</style>`;
				html = this.replaceAnchor(html, '</head>', `${openWithCss}\n</head>`);

				// Inject "Open With..." button after the "Open" button in secondary toolbar.
				const openWithButton = '\n\t\t\t\t\t\t<button id="notebookOpenWith" class="toolbarButton labeled" type="button" tabindex="0" title="Open With...">\n\t\t\t\t\t\t\t<span>Open With...</span>\n\t\t\t\t\t\t</button>';
				html = this.replaceAnchor(
					html,
					/(<button id="secondaryOpenFile"[^]*?<\/button>)/,
					`$1\n${openWithButton}`
				);

				// Inject script to handle "Open With..." click.
				const openWithScript = `<script>
					document.addEventListener('DOMContentLoaded', function() {
						var btn = document.getElementById('notebookOpenWith');
						if (btn) {
							btn.addEventListener('click', function() {
								window.parent.postMessage({ channel: 'pdf-open-with' }, '*');
							});
						}
					});
				</script>`;
				html = this.replaceAnchor(html, '</head>', `${openWithScript}\n</head>`);

				res.type('text/html');
				return res.send(html);
			} catch (err) {
				console.error('Error serving notebook viewer.html:', err);
				return res.status(500).send('Error loading PDF viewer');
			}
		});

		// Serve static pdfjs files for the notebook viewer path too.
		this.app.use('/pdfjs-notebook', express.static(
			path.join(this.extensionPath, 'pdfjs-dist')
		));

		// Serve individual PDFs with unique IDs.
		this.app.get('/pdf/:pdfId', async (req: express.Request, res: express.Response) => {
			// Validate PDF ID parameter.
			try {
				// Look up PDF path by ID.
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
	}

	/**
	 * Start the HTTP server.
	 */
	private async startServer(): Promise<void> {
		// If the server is already running or starting, return the existing promise.
		if (this.startupPromise) {
			return this.startupPromise;
		}

		// Start the server and listen on a random available port.
		this.startupPromise = new Promise<void>((resolve, reject) => {
			try {
				// Start listening on localhost with a random port.
				this.server = this.app.listen(0, 'localhost', () => {
					const address = this.server!.address();
					if (!address || typeof address === 'string') {
						reject(new Error('Failed to get server address'));
						return;
					}
					this.serverPort = address.port;
					resolve();
				});

				// Handle server errors.
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
				// Reject on any synchronous errors that occur during server startup.
				reject(err);
			}
		});

		// Return the startup promise to allow callers to wait for the server to be ready.
		return this.startupPromise;
	}

	/**
	 * Get the server URL with remote compatibility.
	 */
	public async getExternalUrl(): Promise<string> {
		// Ensure server is started.
		await this.startServer();

		// Construct the local URL and convert it to an external URL that works in remote environments.
		const localUrl = `http://localhost:${this.serverPort}`;

		// Parse the local URL and convert it to an external URL using VS Code's API. This handles remote development scenarios.
		const uri = vscode.Uri.parse(localUrl);
		const externalUri = await vscode.env.asExternalUri(uri);

		// Return the external URL as a string for use in the webview. The webview will use this URL to access the server, and it will work correctly in both local and remote environments.
		return externalUri.toString();
	}

	/**
	 * Register a PDF document with the server.
	 */
	public registerPdf(pdfUri: vscode.Uri): string {
		// Generate unique UUID for PDF ID.
		const pdfId = crypto.randomUUID();
		this.pdfs.set(pdfId, pdfUri.fsPath);

		// Return the PDF ID to be used in the viewer URL. The webview will use this ID to request the PDF from the server.
		return pdfId;
	}

	/**
	 * Unregister a PDF document from the server.
	 */
	public unregisterPdf(pdfId: string): void {
		// Remove the PDF from the map.
		this.pdfs.delete(pdfId);
	}

	/**
	 * Dispose the server.
	 */
	public static dispose(): void {
		// Stop the server if it's running and clear the singleton instance.
		if (PdfHttpServer.instance) {
			if (PdfHttpServer.instance.server) {
				PdfHttpServer.instance.server.close();
			}
			PdfHttpServer.instance = undefined;
		}
	}
}
