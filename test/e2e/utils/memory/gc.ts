/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Forces a garbage collection in Positron's shared process over the Chrome
 * DevTools Protocol, before a memory snapshot samples it.
 *
 * The shared process swings 114-144 MB launch to launch depending on whether V8
 * happened to have collected its startup garbage by the time sampling ran.
 * Forcing a GC before sampling converges every launch to within ~3 MB, which is
 * the only way to make the figure comparable across launches at all.
 */

/** `--inspect-sharedprocess` port opened on memory-scenario launches so this module can reach it. */
export const SHARED_PROCESS_INSPECT_PORT = 5879;

export interface SharedProcessGcStats {
	pid: number;
	preRssBytes: number;
	postRssBytes: number;
	preHeapTotalBytes: number;
	postHeapTotalBytes: number;
}

/** Minimal structural slice of the DOM/Node WebSocket this module actually uses. */
export interface WebSocketLike {
	send(data: string): void;
	close(): void;
	onmessage: ((event: { data: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export type WsConnect = (url: string) => Promise<WebSocketLike>;

/** Opens a real WebSocket, resolving once it has connected. */
const defaultConnect: WsConnect = (url: string) => new Promise((resolve, reject) => {
	const ws = new WebSocket(url);
	ws.onopen = () => resolve(ws as unknown as WebSocketLike);
	ws.onerror = (event) => reject(new Error(`WebSocket connection to ${url} failed: ${String(event)}`));
});

/** How long any single CDP round trip may take before this module gives up on the whole GC pass. */
const MESSAGE_TIMEOUT_MS = 10_000;

/** The two collectGarbage passes are spaced out so the second can catch what the first's finalizers freed. */
const FIRST_PASS_SETTLE_MS = 3_000;
const SECOND_PASS_SETTLE_MS = 2_000;

type MemoryUsagePayload = { pid: number; mem: { rss: number; heapTotal: number } };

class CdpClient {
	private nextId = 1;
	private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

	constructor(private readonly ws: WebSocketLike, private readonly port: number) {
		this.ws.onmessage = (event) => this.handleMessage(event.data);
		this.ws.onerror = (event) => this.rejectAllPending(new Error(
			`Shared process inspector on port ${this.port} errored while forcing a GC: ${String(event)}`));
	}

	private handleMessage(raw: string): void {
		let message: any;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		this.pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(
				`Shared process inspector on port ${this.port} rejected a GC request: ${message.error.message ?? JSON.stringify(message.error)}`));
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

	send<T = any>(method: string, params?: object): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(
					`Shared process inspector on port ${this.port} did not reply to ${method} within ${MESSAGE_TIMEOUT_MS}ms`));
			}, MESSAGE_TIMEOUT_MS);
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

async function readMemoryUsage(client: CdpClient, port: number): Promise<MemoryUsagePayload> {
	const result = await client.send<{ result: { value: string } }>('Runtime.evaluate', {
		expression: 'JSON.stringify({ pid: process.pid, mem: process.memoryUsage() })',
		returnByValue: true
	});
	try {
		return JSON.parse(result.result.value);
	} catch (error) {
		throw new Error(`Shared process inspector on port ${port} returned an unparseable memoryUsage payload: ${error}`);
	}
}

function wait(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Forces two garbage collection passes in the shared process reachable at
 * `port`'s CDP endpoint and returns its RSS/heap before and after.
 *
 * Never returns without a real GC having run: any failure along the way
 * (unreachable inspector, a websocket error, a 10s message timeout) throws
 * rather than skipping, because a launch this couldn't reach is not a launch
 * whose shared process figure can be trusted.
 */
export async function collectSharedProcessGarbage(
	port = SHARED_PROCESS_INSPECT_PORT,
	connect: WsConnect = defaultConnect,
	fetchImpl: typeof fetch = fetch
): Promise<SharedProcessGcStats> {
	try {
		const targetsResponse = await fetchImpl(`http://127.0.0.1:${port}/json`);
		const targets = await targetsResponse.json() as { webSocketDebuggerUrl?: string }[];
		const target = targets[0];
		if (!target?.webSocketDebuggerUrl) {
			throw new Error(`Shared process inspector on port ${port} listed no debuggable target`);
		}

		const ws = await connect(target.webSocketDebuggerUrl);
		const client = new CdpClient(ws, port);
		try {
			const pre = await readMemoryUsage(client, port);

			await client.send('HeapProfiler.enable');
			await client.send('HeapProfiler.collectGarbage');
			await wait(FIRST_PASS_SETTLE_MS);
			// A second pass catches objects only freed by the first pass's finalizers.
			await client.send('HeapProfiler.collectGarbage');
			await wait(SECOND_PASS_SETTLE_MS);

			const post = await readMemoryUsage(client, port);

			return {
				pid: pre.pid,
				preRssBytes: pre.mem.rss,
				postRssBytes: post.mem.rss,
				preHeapTotalBytes: pre.mem.heapTotal,
				postHeapTotalBytes: post.mem.heapTotal
			};
		} finally {
			client.close();
		}
	} catch (error) {
		if (error instanceof Error && error.message.includes(`port ${port}`)) {
			throw error;
		}
		throw new Error(
			`Shared process inspector on port ${port} was unreachable, or forcing a GC through it failed: ${error}`);
	}
}
