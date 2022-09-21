/*
 * ConsolePanel.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

import * as vscode from 'vscode';
import { JupyterMessagePacket } from '@internal/jupyter-wire';
import { JupyterKernel, KernelStatus } from './JupyterKernel';
import * as os from 'os';
import * as path from 'path';
import { JupyterInputRequest } from '@internal/jupyter-wire/JupyterInputRequest';
import { v4 as uuidv4 } from 'uuid';
import { JupyterInputReply } from '@internal/jupyter-wire/JupyterInputReply';

/**
 * Myriac Console webview panel container
 */
export class MyriacConsolePanel {
    public static readonly viewType = "myriacConsolePanel";

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _extensionPath: string;
    private readonly _kernel: JupyterKernel;
    private _disposables: vscode.Disposable[] = [];

    public static create(kernel: JupyterKernel, extensionUri: vscode.Uri, extensionPath: string): MyriacConsolePanel {
        const panel = vscode.window.createWebviewPanel(
            "myriacConsolePanel",
            "Myriac Console",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(extensionPath, "console"))
                ]
            }
        );
        return new MyriacConsolePanel(kernel, panel, extensionUri, extensionPath);
    }

    private constructor(kernel: JupyterKernel, panel: vscode.WebviewPanel, extensionUri: vscode.Uri, extensionPath: string) {
        this._kernel = kernel;
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._extensionPath = extensionPath;

        // Populate initial contents
        this._update();

        // Dipose this instance when panel is disposed
        this._panel.onDidDispose(
            () => this.dispose(),
            null,
            this._disposables
        );

        // Handle postmessage-style messages from webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                    case 'jupyter-message':
                        kernel.sendMessage(message as JupyterMessagePacket);
                }
            },
            null,
            this._disposables
        );

        // Forward Jupyter messages from the kernel into the webview
        this.onMessage = this.onMessage.bind(this);
        this._kernel.addListener("message", this.onMessage);

        // Forward kernel status changes into the webview
        this.onStatus = this.onStatus.bind(this);
        this._kernel.addListener("status", this.onStatus);

        // Update content when view state changes
        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

    }

    private onMessage(message: JupyterMessagePacket) {
        if (message.msgType === "input_request") {
            let request = message.message as JupyterInputRequest;
            // Prompt the user for input using the VS Code api
            vscode.window.showInputBox({ prompt: request.prompt, password: request.password }).then(input => {
                // Ensure the input is a string (if user cancels, input is
                // undefined)
                if (!input) {
                    input = "";
                }

                // Create and send a reply to the kernel
                this._kernel.sendMessage({
                    type: "jupyter-message",
                    msgType: "input_reply",
                    msgId: uuidv4(),
                    originId: message.msgId,
                    message: {
                        value: input
                    } as JupyterInputReply,
                    socket: message.socket
                });
            });
        }
        this._panel.webview.postMessage(message);
    }

    private onStatus(status: KernelStatus) {
        this._panel.webview.postMessage(
            { type: "kernel-status", status: status }
        );
    }

    /**
     * Set HTML content
     */
    private _update() {
        const reactPath = vscode.Uri.file(
            path.join(this._extensionPath, "console", "console.js")
        );
        const reactUri = reactPath.with({ scheme: "vscode-resource" });

        // Add a JSON copy of the kernel status to the HTML
        const kernelStatus = {
            spec: this._kernel.spec(),
            status: this._kernel.status()
        };
        const kernelJson = JSON.stringify(kernelStatus);

        const kernelHtml = `<script>window.kernel = ${kernelJson}</script>`;
        const reactHtml = `<script src="${reactUri}">`;
        this._panel.webview.html = `${kernelHtml}<body><div id="root"></div></body>${reactHtml}`;
        path.join(os.homedir());
    }

    /**
     * Dispose panel
     */
    public dispose() {
        this._panel.dispose();
        this._kernel.removeListener("message", this.onMessage);
        this._kernel.removeListener("status", this.onStatus);
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}