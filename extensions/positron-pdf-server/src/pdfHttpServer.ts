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
	private extensionPath: string | undefined;

	/**
	 * Private constructor for singleton pattern.
	 */
	private constructor() {
		this.app = express();
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
	 * Initialize the server with the extension path.
	 * Must be called before using the server.
	 */
	public initialize(extensionPath: string): void {
		if (!this.extensionPath) {
			this.extensionPath = extensionPath;
			this.setupRoutes();
		}
	}

	/**
	 * Setup Express routes.
	 */
	private setupRoutes(): void {
		if (!this.extensionPath) {
			throw new Error('Server not initialized. Call initialize() with extension path first.');
		}

		// Serve PDF.js distribution files statically (includes web/viewer.html, build/, etc.).
		this.app.use('/pdfjs', express.static(
			path.join(this.extensionPath, 'pdfjs-dist')
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
