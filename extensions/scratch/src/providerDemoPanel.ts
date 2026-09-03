/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import type { DemoConfig, DemoProvider, HostMessage, WebviewMessage } from './providerDemoProtocol.js';

const VIEW_TYPE = 'scratch.providerDemo';

/** Show a secret's shape without putting the secret itself on screen. */
function redact(value: string | undefined): string {
	if (!value) {
		return '(absent)';
	}
	return `${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)`;
}

/**
 * Opens the provider demo as a modal webview panel.
 *
 * Everything the panel can do is reachable from an extension today: the list
 * comes from `positron.ai.getRegisteredProviders`, the actions go through the
 * transitional `positron.ai.runLegacyProviderAction` bridge, and the credential
 * read goes through `vscode.authentication` under `trustedExtensionAuthAccess`.
 * The only new piece is `positron.window.createModalWebviewPanel`.
 */
export function openProviderDemo(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): vscode.WebviewPanel {
	const panel = positron.window.createModalWebviewPanel(VIEW_TYPE, 'Scratch Provider Demo', {
		enableScripts: true,
		// Deliberately not `retainContextWhenHidden`: a modal is a transient
		// surface, and keeping the iframe alive after it closes would hide
		// state bugs that a real dialog would surface.
		localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
	});

	panel.webview.html = renderHtml(panel.webview, context.extensionUri);

	const post = (message: HostMessage) => {
		// Fire-and-forget: postMessage resolves false once the panel is gone,
		// which is expected during teardown and not worth reporting.
		void panel.webview.postMessage(message);
	};

	const sendProviders = async () => {
		const sources = await positron.ai.getRegisteredProviders();
		const providers: DemoProvider[] = sources.map(source => ({
			id: source.provider.id,
			displayName: source.provider.displayName,
			signedIn: source.signedIn ?? false,
			status: source.status ?? null,
			statusMessage: source.statusMessage,
			supportedOptions: source.supportedOptions,
			authMethods: source.authMethods,
			baseUrlDefault: source.defaults.baseUrl,
		}));
		log.info(`providerDemo: sending ${providers.length} providers`);
		post({ type: 'providers', providers });
	};

	const runAction = async (requestId: number, providerId: string, action: string, config: DemoConfig) => {
		// Log which fields were sent, never their values -- apiKey is a secret and
		// this channel ends up in the output pane.
		const fields = Object.keys(config);
		const shape = fields.length > 0 ? `{ ${fields.join(', ')} }` : '{}';
		try {
			// Every LanguageModelConfig field is optional, so `{}` is a valid
			// payload and the right one for the verbs that ignore config.
			await positron.ai.runLegacyProviderAction(providerId, config, action);
			log.info(`providerDemo: runLegacyProviderAction('${providerId}', '${action}', ${shape}) resolved`);
			post({ type: 'result', requestId, ok: true, detail: `${action} resolved with ${shape}` });
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			log.error(`providerDemo: runLegacyProviderAction('${providerId}', '${action}', ${shape}) rejected: ${message}`);
			post({ type: 'result', requestId, ok: false, detail: message });
		}
	};

	const inspectCredential = async (requestId: number, providerId: string) => {
		try {
			// `silent` rather than `createIfNone`: a consent or sign-in prompt
			// raised from inside a modal would stack a dialog on a dialog. Run
			// the Hello World command once to grant consent instead.
			const session = await vscode.authentication.getSession(providerId, [], { silent: true });
			if (!session) {
				post({
					type: 'result', requestId, ok: false,
					detail: 'No session. Either this extension is not allow-listed for this provider, or consent has not been granted yet.',
				});
				return;
			}

			// The AWS provider serializes {accessKeyId, secretAccessKey,
			// sessionToken} as JSON into accessToken; it is not a bearer token.
			// Anything else is reported by shape only.
			let detail: string;
			try {
				const creds = JSON.parse(session.accessToken) as Record<string, string | undefined>;
				detail = [
					`account: ${session.account.label}`,
					`accessKeyId: ${creds.accessKeyId ?? '(absent)'}`,
					`secretAccessKey: ${redact(creds.secretAccessKey)}`,
					`sessionToken: ${redact(creds.sessionToken)}`,
				].join('\n');
			} catch {
				detail = `account: ${session.account.label}\naccessToken: ${redact(session.accessToken)}`;
			}

			log.info(`providerDemo: resolved a session for ${providerId}`);
			post({ type: 'result', requestId, ok: true, detail });
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			log.error(`providerDemo: getSession('${providerId}') failed: ${message}`);
			post({ type: 'result', requestId, ok: false, detail: message });
		}
	};

	// Scoped to the panel, not to `context.subscriptions`: this function runs once
	// per command invocation, so registering on the extension would accumulate a
	// listener per open and keep every closed panel's closure alive.
	const listener = panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
		switch (message.type) {
			case 'ready':
			case 'refresh':
				await sendProviders();
				return;
			case 'runAction':
				await runAction(message.requestId, message.providerId, message.action, message.config);
				return;
			case 'inspectCredential':
				await inspectCredential(message.requestId, message.providerId);
				return;
			case 'close':
				panel.dispose();
				return;
		}
	});
	panel.onDidDispose(() => listener.dispose());

	return panel;
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'providerDemo.js'));
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'providerDemo.css'));
	const nonce = getNonce();

	// The bundle is ESM (see esbuild.webview.mts), hence type="module".
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>Scratch Provider Demo</title>
</head>
<body>
	<div id="root"></div>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}
