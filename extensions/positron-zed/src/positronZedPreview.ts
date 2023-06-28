/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';

export class ZedPreview {
	constructor(readonly panel: positron.PreviewPanel) {
		panel.webview.html = this.getPreviewContents();

		panel.onDidChangeViewState(() => {
			this.panel.webview.postMessage(
				`onDidChangeViewState: ${this.panel.active}`);
		});
	}

	public addRecentCommand(command: string): void {
		// Send the command as a message to the webview.
		// The webview will add it to the list of recently executed commands.
		this.panel.webview.postMessage(`Executed '${command}'`);
	}

	private getPreviewContents(): string {
		return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<title>Zed Preview</title>
	<script>
		// Zed commands are sent as messages from the extension to the webview.
        window.addEventListener('message', event => {
            const message = event.data;
			const ele = document.createElement('li');
			ele.innerText = message;
			document.getElementById('commandList').appendChild(ele);
        });
    </script>
</head>
<body>
	<h1>Zed Preview</h1>
	<h2>Things that Happened</h2>
	<ol id="commandList">
	</ol>
</body>
</html>
		`;
	}
}
