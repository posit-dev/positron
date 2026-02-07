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
	 * Setup Express routes.
	 */
	private setupRoutes(): void {
		// Ensure extension path is set before setting up routes.
		if (!this.extensionPath) {
			throw new Error('Server not initialized. Call initialize() with extension path first.');
		}

		// Serve PDF.js distribution files statically (includes web/viewer.html, build/, etc.).
		this.app.use('/pdfjs', express.static(
			path.join(this.extensionPath, 'pdfjs-dist')
		));

		// Serve custom viewer wrapper.
		this.app.get('/viewer', (_req: express.Request, res: express.Response) => {
			res.sendFile(path.join(this.extensionPath!, 'viewer-wrapper.html'));
		});

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
					// console.log(`PDF server started on port ${this.serverPort}`);
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

		// Log the local URL for debugging. In remote environments, this will be transformed to an external URL.
		// console.log(`Local URL: ${localUrl}`);

		// Parse the local URL and convert it to an external URL using VS Code's API. This handles remote development scenarios.
		const uri = vscode.Uri.parse(localUrl);
		const externalUri = await vscode.env.asExternalUri(uri);

		// Log the external URL for debugging. In local environments, this will be the same as the local URL. In remote environments, it will be different.
		// console.log(`External URL: ${externalUri.toString()}`);

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

		// Log the registration for debugging.
		// console.log(`Registered PDF ${pdfId}: ${pdfUri.fsPath}`);

		// Return the PDF ID to be used in the viewer URL. The webview will use this ID to request the PDF from the server.
		return pdfId;
	}

	/**
	 * Unregister a PDF document from the server.
	 */
	public unregisterPdf(pdfId: string): void {
		// Remove the PDF from the map.
		if (this.pdfs.delete(pdfId)) {
			// Log the unregistration for debugging.
			// console.log(`Unregistered PDF ${pdfId}`);
		}
	}

	/**
	 * Dispose the server.
	 */
	public static dispose(): void {
		// Stop the server if it's running and clear the singleton instance.
		if (PdfHttpServer.instance) {
			if (PdfHttpServer.instance.server) {
				PdfHttpServer.instance.server.close();
				console.log('PDF server stopped');
			}
			PdfHttpServer.instance = undefined;
		}
	}
}
