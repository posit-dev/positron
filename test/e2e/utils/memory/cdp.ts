/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A minimal Chrome DevTools Protocol client for the inspector ports Positron
 * opens with `--inspect-sharedprocess` and `--inspect-extensions`.
 *
 * Two callers, which is why this is not inside either: `gc.ts` forces a
 * collection before sampling, and `heap-capture.ts` streams a heap snapshot
 * after it. The second needs events, which a response-only client drops on the
 * floor without saying so.
 */

/** Minimal structural slice of the DOM/Node WebSocket this module actually uses. */
export interface WebSocketLike {
	send(data: string): void;
	close(): void;
	onmessage: ((event: { data: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export type WsConnect = (url: string) => Promise<WebSocketLike>;

/**
 * Opens a real WebSocket, resolving once it has connected.
 *
 * Bounded: a port that accepts the TCP connection but never completes the
 * handshake fires neither callback, and this is awaited before the caller's own
 * try/catch exists, so an unbounded wait here reaches the Playwright timeout and
 * costs the launch its PSS datapoint.
 */
export const defaultConnect: WsConnect = (url: string) => new Promise((resolve, reject) => {
	const ws = new WebSocket(url);
	const timeout = setTimeout(() => {
		ws.close();
		reject(new Error(`WebSocket connection to ${url} did not open within ${MESSAGE_TIMEOUT_MS}ms`));
	}, MESSAGE_TIMEOUT_MS);
	ws.onopen = () => { clearTimeout(timeout); resolve(ws as unknown as WebSocketLike); };
	ws.onerror = (event) => {
		clearTimeout(timeout);
		reject(new Error(`WebSocket connection to ${url} failed: ${String(event)}`));
	};
});

/** How long any single CDP round trip may take before the caller gives up. */
export const MESSAGE_TIMEOUT_MS = 10_000;

export class CdpClient {
	private nextId = 1;
	private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	private readonly handlers = new Map<string, ((params: any) => void)[]>();

	/** `context` names the target for error messages, e.g. `extension host inspector on port 5870`. */
	constructor(private readonly ws: WebSocketLike, private readonly context: string) {
		this.ws.onmessage = (event) => this.handleMessage(event.data);
		this.ws.onerror = (event) => this.rejectAllPending(new Error(`${this.context} errored: ${String(event)}`));
	}

	private handleMessage(raw: string): void {
		let message: any;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		if (message.method !== undefined) {
			for (const handler of this.handlers.get(message.method) ?? []) {
				handler(message.params);
			}
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		this.pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(`${this.context} rejected a request: ${message.error.message ?? JSON.stringify(message.error)}`));
		} else {
			pending.resolve(message.result);
		}
	}

	private rejectAllPending(error: Error): void {
		for (const { reject } of this.pending.values()) {
			reject(error);
		}
		this.pending.clear();
	}

	/** Subscribes to a CDP event. Handlers run in registration order. */
	on(method: string, handler: (params: any) => void): void {
		const existing = this.handlers.get(method) ?? [];
		existing.push(handler);
		this.handlers.set(method, existing);
	}

	send<T = any>(method: string, params?: object, timeoutMs = MESSAGE_TIMEOUT_MS): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${this.context} did not reply to ${method} within ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (value) => { clearTimeout(timeout); resolve(value); },
				reject: (error) => { clearTimeout(timeout); reject(error); }
			});
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	close(): void {
		this.ws.close();
	}
}

/** Opens a client against the first debuggable target an inspector port lists. */
export async function connectToInspector(
	port: number,
	label: string,
	connect: WsConnect = defaultConnect,
	fetchImpl: typeof fetch = fetch
): Promise<CdpClient> {
	const context = `${label} inspector on port ${port}`;
	// Bounded like every other step: an inspector port that accepts the
	// connection but never answers would otherwise hang with no timeout at all.
	const response = await fetchImpl(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(MESSAGE_TIMEOUT_MS) });
	const targets = await response.json() as { webSocketDebuggerUrl?: string }[];
	const target = targets[0];
	if (!target?.webSocketDebuggerUrl) {
		throw new Error(`${context} listed no debuggable target`);
	}
	return new CdpClient(await connect(target.webSocketDebuggerUrl), context);
}
