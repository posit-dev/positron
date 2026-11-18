/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { hasKey } from '../../../../base/common/types.js';
import { CDPEvent, CDPResponse, CDPTargetInfo } from '../../../../platform/browserView/common/cdp/types.js';
import { IBrowserViewCDPService } from '../../browserView/common/browserView.js';
import { VIEWER_CONTENT_CHANGED_MESSAGE } from '../browser/previewSurface.js';

/** CDP errors for a call that was cut off by the page navigating away. */
const NAVIGATED_ERRORS = ['Execution context was destroyed', 'Inspected target navigated or closed'];

/** Thrown when the page went to another address before a script finished. */
export class PageNavigatedError extends Error {
	constructor() {
		super(VIEWER_CONTENT_CHANGED_MESSAGE);
	}
}

interface IRuntimeEvaluateResult {
	readonly result?: { readonly value?: unknown };
	readonly exceptionDetails?: { readonly text: string; readonly exception?: { readonly description?: string } };
}

/**
 * A CDP connection to the page in one browser view, for running scripts in
 * it. It connects on first use, and again after its connection is lost.
 */
export class BrowserViewBridgeSession extends Disposable {

	/** The connection's session group, and its CDP session attached to the page. */
	private _session: Promise<{ readonly groupId: string; readonly sessionId: string }> | undefined;
	private readonly _connection = this._register(new DisposableStore());

	private _nextId = 1;
	private readonly _pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();

	constructor(
		private readonly _browserId: string,
		@IBrowserViewCDPService private readonly _cdpService: IBrowserViewCDPService,
	) {
		super();
	}

	/**
	 * Evaluates a script in the page's main world, waiting for the promise it
	 * returns, and returns its value.
	 */
	async evaluate(expression: string): Promise<unknown> {
		const { groupId, sessionId } = await this.session();
		let response: IRuntimeEvaluateResult;
		try {
			response = await this.sendTo(groupId, sessionId, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }) as IRuntimeEvaluateResult;
		} catch (error) {
			if (NAVIGATED_ERRORS.some(message => (error as Error).message.includes(message))) {
				throw new PageNavigatedError();
			}
			throw error;
		}
		if (response.exceptionDetails) {
			throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
		}
		return response.result?.value;
	}

	private session(): Promise<{ readonly groupId: string; readonly sessionId: string }> {
		this._session ??= this.connect().catch(error => {
			this.disconnect(error);
			throw error;
		});
		return this._session;
	}

	/**
	 * Opens a session group for the view, and attaches to its page.
	 */
	private async connect(): Promise<{ readonly groupId: string; readonly sessionId: string }> {
		const groupId = await this._cdpService.createSessionGroup(this._browserId);
		if (this._store.isDisposed) {
			await this._cdpService.destroySessionGroup(groupId);
			throw new Error(VIEWER_CONTENT_CHANGED_MESSAGE);
		}
		this._connection.add({ dispose: () => this._cdpService.destroySessionGroup(groupId).catch(() => { }) });
		this._connection.add(this._cdpService.onCDPMessage(groupId)(message => this.receive(message)));
		this._connection.add(this._cdpService.onDidDestroy(groupId)(() => this.disconnect(new Error(VIEWER_CONTENT_CHANGED_MESSAGE))));

		const { targetInfos } = await this.sendTo(groupId, undefined, 'Target.getTargets') as { targetInfos: CDPTargetInfo[] };
		const target = targetInfos.find(info => info.type === 'page' && info.vscodeBrowserViewId === this._browserId);
		if (!target) {
			throw new Error('The Viewer\'s content hasn\'t loaded yet.');
		}
		const { sessionId } = await this.sendTo(groupId, undefined, 'Target.attachToTarget', { targetId: target.targetId, flatten: true }) as { sessionId: string };
		return { groupId, sessionId };
	}

	private sendTo(groupId: string, sessionId: string | undefined, method: string, params?: unknown): Promise<unknown> {
		const id = this._nextId++;
		return new Promise((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			this._cdpService.sendCDPMessage(groupId, { id, method, params, sessionId }).catch(error => {
				this._pending.delete(id);
				reject(error);
			});
		});
	}

	private receive(message: CDPResponse | CDPEvent): void {
		if (!hasKey(message, { id: true })) {
			return;
		}
		const pending = this._pending.get(message.id);
		if (!pending) {
			return;
		}
		this._pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(message.error.message));
		} else {
			pending.resolve(message.result);
		}
	}

	/** Drops the connection, failing the calls still waiting on it. */
	private disconnect(error: Error): void {
		this._session = undefined;
		this._connection.clear();
		for (const pending of this._pending.values()) {
			pending.reject(error);
		}
		this._pending.clear();
	}

	override dispose(): void {
		this.disconnect(new Error(VIEWER_CONTENT_CHANGED_MESSAGE));
		super.dispose();
	}
}
