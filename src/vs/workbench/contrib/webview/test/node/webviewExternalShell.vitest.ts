/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from '../../../../../base/common/path.js';

const preDir = join(dirname(fileURLToPath(import.meta.url)), '../../browser/pre');
const shellScript = readFileSync(join(preDir, 'index-external.html'), 'utf8')
	.match(/<script async type="module">(?<script>[\s\S]*?)<\/script>/)?.groups?.script ?? '';

/**
 * The host name the shell expects to be served from, which proves to it who
 * its parent is (see `parentOriginHash` in base/browser/iframe.ts).
 */
function parentOriginHash(parentOrigin: string, salt: string): string {
	const hex = createHash('sha256').update(JSON.stringify({ parentOrigin, salt })).digest('hex');
	return BigInt(`0x${hex}`).toString(32).padStart(52, '0');
}

interface HostMessage {
	readonly channel: string;
	readonly data: unknown;
}

/**
 * Runs the script of index-external.html, the shell that hosts external URLs
 * in the Viewer, against a detached document, playing the host's side of the
 * message port it hands over in its ready handshake.
 */
async function startShell() {
	const document = globalThis.document.implementation.createHTMLDocument();
	const shellWindow = Object.assign(new EventTarget(), {
		focus: () => { },
		parent: {
			postMessage: (_message: unknown, _origin: string, transfer: MessagePort[]) => hostPort.resolve(transfer[0]),
		},
	});
	const hostPort = Promise.withResolvers<MessagePort>();

	const parentOrigin = 'vscode-file://vscode-app';
	const salt = 'webview-origin';
	const host = parentOriginHash(parentOrigin, salt);
	const location = new URL(`https://${host}/index-external.html?${new URLSearchParams({
		id: 'webview-1', origin: salt, parentOrigin, platform: 'electron', disableServiceWorker: 'true',
	})}`);

	new Function('window', 'document', 'location', 'navigator', 'setInterval', shellScript)(
		shellWindow, document, location, { vendor: '', userAgent: '' }, () => { });

	const port = await hostPort.promise;
	const received: HostMessage[] = [];
	port.onmessage = e => received.push(e.data);
	return {
		document,
		received,
		send: (channel: string, args: unknown) => port.postMessage({ channel, args }),
		/** Posts a message to the shell as the content frame's injected script does. */
		postFromContent: (data: HostMessage) => shellWindow.dispatchEvent(new MessageEvent('message', { data })),
		// eslint-disable-next-line no-restricted-syntax -- the shell's frames have no role; how many there are is what's under test
		frames: () => Array.from(document.getElementsByTagName('iframe'), frame => ({ id: frame.id, src: frame.getAttribute('src') })),
		close: () => port.close(),
	};
}

/**
 * Pages are named with about:blank URLs, which load without a server, so each
 * one gets a window of its own.
 */
const page = (name: string) => `about:blank#${name}`;

describe('Viewer external content shell', () => {
	let shell: Awaited<ReturnType<typeof startShell>>;

	beforeEach(async () => {
		vi.spyOn(console, 'log').mockImplementation(() => { });
		shell = await startShell();
	});

	afterEach(() => shell.close());

	it('replaces the old page when a new URL is set', async () => {
		shell.send('set-uri', page('app'));
		await vi.waitFor(() => expect(shell.frames()).toHaveLength(1));
		shell.send('set-uri', page('typed'));
		shell.send('set-uri', page('refuses-framing'));

		// Only the last page is left, so nothing beneath it shows through or
		// takes input.
		await vi.waitFor(() => expect(shell.frames()).toEqual([
			{ id: 'active-frame', src: page('refuses-framing') },
		]));
	});

	it('sends commands to the page that is showing', async () => {
		shell.send('set-uri', page('app'));
		await vi.waitFor(() => expect(shell.frames()).toHaveLength(1));
		shell.send('set-uri', page('typed'));
		await vi.waitFor(() => expect(shell.frames()).toEqual([{ id: 'active-frame', src: page('typed') }]));

		const commands: unknown[] = [];
		// eslint-disable-next-line no-restricted-syntax -- the shell's frames have no role
		const frame = shell.document.getElementsByTagName('iframe')[0];
		frame?.contentWindow?.addEventListener('message', e => commands.push(e.data));
		shell.send('execCommand', 'reload-window');

		await vi.waitFor(() => expect(commands).toEqual([{ channel: 'execCommand', data: 'reload-window' }]));
	});

	it('forwards each message from the content to the host once, however many pages were loaded', async () => {
		shell.send('set-uri', page('app'));
		shell.send('set-uri', page('other'));
		await vi.waitFor(() => expect(shell.frames()).toEqual([{ id: 'active-frame', src: page('other') }]));

		shell.postFromContent({ channel: 'did-load-window', data: { title: 'Other' } });
		shell.postFromContent({ channel: 'done', data: undefined });
		await vi.waitFor(() => expect(shell.received.at(-1)?.channel).toBe('done'));

		expect(shell.received.filter(m => m.channel === 'did-load-window')).toEqual([
			{ channel: 'did-load-window', data: { title: 'Other' } },
		]);
	});
});
