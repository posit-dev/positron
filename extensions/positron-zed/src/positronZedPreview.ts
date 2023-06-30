/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import fs = require('fs');

import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * ZedPreview is a wrapper around a positron.PreviewPanel. It helps exercise
 * the preview API and demonstrates how to communicate between the extension
 * and the webview.
 *
 * The webview's HTML sources are in the resources/preview.html file, and they
 * contain a simple page that displays any messages sent to it from the
 * extension.
 */
export class ZedPreview {
	constructor(
		private readonly context: vscode.ExtensionContext,
		readonly panel: positron.PreviewPanel) {
		panel.webview.html = this.getPreviewContents();

		panel.onDidChangeViewState(() => {
			this.panel.webview.postMessage(
				`onDidChangeViewState: active=${this.panel.active}, visible=${this.panel.visible}`);
		});

		panel.webview.onDidReceiveMessage(message => {
			if (message === 'message') {
				// The webview sent us a message; send one back to demonstrate
				// roundtrip communication.
				this.panel.webview.postMessage(`Received message`);
			} else if (message === 'close') {
				// The webview has asked to be closed.
				this.panel.dispose();
			}
		});
	}

	// Expose the onDidDispose event from the panel.
	onDidDispose = this.panel.onDidDispose;

	public visible(): boolean {
		return this.panel.visible;
	}

	public show(): void {
		this.panel.reveal();
	}

	public close(): void {
		this.panel.dispose();
	}

	public sendMessage(): void {
		this.panel.webview.postMessage('Recived message from console.');
	}

	public addRecentCommand(command: string): void {
		// Send the command as a message to the webview.
		// The webview will add it to the list of recently executed commands.
		this.panel.webview.postMessage(`Executed '${command}'`);
	}

	private getPreviewContents(): string {
		// Get the contents of the preview.html file from the extension's resources folder
		// and return it as a string.
		const previewHtmlPath = path.join(this.context.extensionPath,
			'resources',
			'preview.html');
		const previewContents = fs.readFileSync(previewHtmlPath, 'utf8');
		return previewContents;
	}
}
