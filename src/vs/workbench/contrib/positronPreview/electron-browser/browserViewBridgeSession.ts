/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { hasKey } from '../../../../base/common/types.js';
import { CDPEvent, CDPResponse, CDPTargetInfo } from '../../../../platform/browserView/common/cdp/types.js';
import { IBrowserViewCDPService } from '../../browserView/common/browserView.js';
import { VIEWER_CONTENT_CHANGED_MESSAGE, ViewerInputStep } from '../browser/previewSurface.js';

/** CDP errors for a call that was cut off by the page navigating away. */
const NAVIGATED_ERRORS = ['Execution context was destroyed', 'Inspected target navigated or closed'];

/** Thrown when the page went to another address before a script finished. */
export class PageNavigatedError extends Error {
	constructor() {
		super(VIEWER_CONTENT_CHANGED_MESSAGE);
	}
}

/** CDP's bits for the modifier keys. */
const MODIFIER_BITS: Record<string, { readonly key: string; readonly bit: number }> = {
	alt: { key: 'Alt', bit: 1 }, option: { key: 'Alt', bit: 1 },
	control: { key: 'Control', bit: 2 }, ctrl: { key: 'Control', bit: 2 },
	meta: { key: 'Meta', bit: 4 }, cmd: { key: 'Meta', bit: 4 }, command: { key: 'Meta', bit: 4 },
	shift: { key: 'Shift', bit: 8 },
	controlormeta: isMacintosh ? { key: 'Meta', bit: 4 } : { key: 'Control', bit: 2 },
};

/** Named keys: their code, legacy key code, and the text they type. */
const NAMED_KEYS: Record<string, { readonly code: string; readonly keyCode: number; readonly text?: string }> = {
	Enter: { code: 'Enter', keyCode: 13, text: '\r' }, Tab: { code: 'Tab', keyCode: 9 }, Backspace: { code: 'Backspace', keyCode: 8 },
	Escape: { code: 'Escape', keyCode: 27 }, Delete: { code: 'Delete', keyCode: 46 }, ' ': { code: 'Space', keyCode: 32, text: ' ' },
	ArrowLeft: { code: 'ArrowLeft', keyCode: 37 }, ArrowUp: { code: 'ArrowUp', keyCode: 38 },
	ArrowRight: { code: 'ArrowRight', keyCode: 39 }, ArrowDown: { code: 'ArrowDown', keyCode: 40 },
	Home: { code: 'Home', keyCode: 36 }, End: { code: 'End', keyCode: 35 }, PageUp: { code: 'PageUp', keyCode: 33 }, PageDown: { code: 'PageDown', keyCode: 34 },
	Control: { code: 'ControlLeft', keyCode: 17 }, Shift: { code: 'ShiftLeft', keyCode: 16 }, Alt: { code: 'AltLeft', keyCode: 18 }, Meta: { code: 'MetaLeft', keyCode: 91 },
};

/**
 * Editing shortcuts on macOS, which the app menu carries out rather than the
 * page, so CDP has to name the command.
 */
const MAC_COMMANDS: Record<string, string> = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo', Z: 'redo' };

/** The CDP key event for a key, which can be a character. */
function keyInfo(key: string): { readonly key: string; readonly code: string; readonly windowsVirtualKeyCode: number; readonly text?: string } {
	const named = NAMED_KEYS[key];
	if (named) {
		return { key, code: named.code, windowsVirtualKeyCode: named.keyCode, text: named.text };
	}
	if (/^F([1-9]|1[0-2])$/.test(key)) {
		return { key, code: key, windowsVirtualKeyCode: 111 + Number(key.slice(1)) };
	}
	if ([...key].length === 1) {
		const letter = /^[a-z]$/i.test(key);
		const digit = /^[0-9]$/.test(key);
		return {
			key,
			code: letter ? `Key${key.toUpperCase()}` : digit ? `Digit${key}` : '',
			windowsVirtualKeyCode: letter || digit ? key.toUpperCase().charCodeAt(0) : 0,
			text: key,
		};
	}
	throw new Error(`${JSON.stringify(key)} isn't a key. Use a character or a key name such as Enter, Tab, Escape or ArrowDown.`);
}

/** The CDP key events to press and release a key or combination such as "Control+a". */
function keyEvents(combo: string): Record<string, unknown>[] {
	const parts = combo.length > 1 ? combo.split(/\+(?=.)/) : [combo];
	const last = parts.pop()!;
	const key = last === 'Space' || last === 'Spacebar' ? ' ' : last;
	const events: Record<string, unknown>[] = [];
	const held: string[] = [];
	let modifiers = 0;
	for (const part of parts) {
		const modifier = MODIFIER_BITS[part.toLowerCase()];
		if (!modifier) {
			throw new Error(`${JSON.stringify(part)} isn't a modifier key. Use Control, Shift, Alt, Meta or ControlOrMeta, as in "Control+a".`);
		}
		modifiers |= modifier.bit;
		held.push(modifier.key);
		events.push({ type: 'rawKeyDown', modifiers, ...keyInfo(modifier.key) });
	}
	const info = keyInfo(key);
	// A shortcut types nothing.
	const types = info.text !== undefined && !(modifiers & (2 | 4));
	const command = isMacintosh && modifiers === 4 ? MAC_COMMANDS[key] : isMacintosh && modifiers === (4 | 8) && key.toLowerCase() === 'z' ? MAC_COMMANDS.Z : undefined;
	events.push({ type: types ? 'keyDown' : 'rawKeyDown', modifiers, ...info, text: types ? info.text : undefined, commands: command ? [command] : undefined });
	events.push({ type: 'keyUp', modifiers, ...info, text: undefined });
	for (const modifierKey of held.reverse()) {
		modifiers &= ~MODIFIER_BITS[modifierKey.toLowerCase()].bit;
		events.push({ type: 'keyUp', modifiers, ...keyInfo(modifierKey) });
	}
	return events;
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
		let response: IRuntimeEvaluateResult;
		try {
			response = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }) as IRuntimeEvaluateResult;
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

	/**
	 * Sends input to the page as the browser gets it from a user. A mouse
	 * button pressed in one step stays down for the moves after it.
	 */
	async dispatchInput(steps: readonly ViewerInputStep[]): Promise<void> {
		let pressed: 'left' | 'right' | 'middle' | undefined;
		const buttonBits = { left: 1, right: 2, middle: 4 };
		for (const step of steps) {
			if (step.type === 'mouse') {
				if (step.action === 'down') {
					pressed = step.button ?? 'left';
				}
				const button = step.action === 'move' ? pressed ?? 'none' : step.button ?? 'left';
				await this.command('Input.dispatchMouseEvent', {
					type: step.action === 'move' ? 'mouseMoved' : step.action === 'down' ? 'mousePressed' : 'mouseReleased',
					x: step.x,
					y: step.y,
					button,
					buttons: step.action === 'up' || !pressed ? 0 : buttonBits[pressed],
					clickCount: step.clickCount ?? (step.action === 'move' ? 0 : 1),
				});
				if (step.action === 'up') {
					pressed = undefined;
				}
			} else if (step.type === 'key') {
				for (const event of keyEvents(step.key)) {
					await this.command('Input.dispatchKeyEvent', event);
				}
			} else {
				for (const ch of step.text) {
					for (const event of keyEvents(ch === '\n' ? 'Enter' : ch)) {
						await this.command('Input.dispatchKeyEvent', event);
					}
				}
			}
		}
	}

	private async command(method: string, params: unknown): Promise<unknown> {
		const { groupId, sessionId } = await this.session();
		return this.sendTo(groupId, sessionId, method, params);
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
