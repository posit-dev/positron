/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';

/* The descriptor used in each runtime's debugger output channel. */
const DebuggerOutputChannelDescriptor = vscode.l10n.t('Debugger');

export class DisposableStore implements vscode.Disposable {
	private _disposables = new Set<vscode.Disposable>();

	public add<T extends vscode.Disposable>(disposable: T): T {
		this._disposables.add(disposable);
		return disposable;
	}

	public dispose(): void {
		for (const disposable of this._disposables) {
			disposable.dispose();
		}

		this._disposables.clear();
	}
}

export abstract class Disposable implements vscode.Disposable {
	private _isDisposed = false;

	protected readonly _disposables = new DisposableStore();

	public dispose(): void {
		if (this._isDisposed) {
			return;
		}
		this._isDisposed = true;
		this._disposables.dispose();
	}

	protected _register<T extends vscode.Disposable>(value: T): T {
		if (this._isDisposed) {
			value.dispose();
		} else {
			this._disposables.add(value);
		}
		return value;
	}

	protected get isDisposed() {
		return this._isDisposed;
	}
}

export function disposableTimeout(handler: () => void, timeout: number): vscode.Disposable {
	const timer = setTimeout(() => {
		handler();
	}, timeout);
	const disposable: vscode.Disposable = {
		dispose() {
			clearTimeout(timer);
		}
	};
	return disposable;
}

type ContextKeyScalar = null | undefined | boolean | number | string | vscode.Uri;

type ContextKeyValue =
	| ContextKeyScalar
	| Array<ContextKeyScalar>
	| Record<string, ContextKeyScalar>;

export class ContextKey<T extends ContextKeyValue = boolean> {
	private _value?: T;

	constructor(private _name: string) { }

	public get(): T | undefined {
		return this._value;
	}

	public async set(value: T): Promise<void> {
		this._value = value;
		await vscode.commands.executeCommand('setContext', this._name, this._value);
	}
}

export class ResourceSetContextKey extends ContextKey<Array<vscode.Uri>> {
	public has(value: vscode.Uri): boolean {
		return Boolean(this.get()?.some((uri) => isUriEqual(uri, value)));
	}

	public async add(value: vscode.Uri): Promise<this> {
		const current = this.get() ?? [];
		if (!current.some((uri) => isUriEqual(uri, value))) {
			current.push(value);
			await this.set(current);
		}
		return this;
	}

	public async delete(value: vscode.Uri): Promise<boolean> {
		const current = this.get() ?? [];
		const index = current.findIndex((uri) => isUriEqual(uri, value));
		if (index === -1) {
			return false;
		}
		current.splice(index, 1);
		await this.set(current);
		return true;
	}
}

export function createDebuggerOutputChannel(runtimeSession: positron.LanguageRuntimeSession): vscode.LogOutputChannel {
	const runtimeName = runtimeSession.runtimeMetadata.runtimeName;
	const sessionMode = runtimeSession.metadata.sessionMode;
	let sessionTitle: string;
	if (runtimeSession.metadata.notebookUri) {
		sessionTitle = path.basename(runtimeSession.metadata.notebookUri.fsPath);
	} else {
		sessionTitle = sessionMode.charAt(0).toUpperCase() + sessionMode.slice(1);
	}
	const name = `${runtimeName}: ${DebuggerOutputChannelDescriptor} (${sessionTitle})`;
	const outputChannel = vscode.window.createOutputChannel(name, { log: true });
	return outputChannel;
}

interface LanguageRuntimeMessageTypeMap {
	[positron.LanguageRuntimeMessageType.DebugEvent]: positron.LanguageRuntimeDebugEvent;
	[positron.LanguageRuntimeMessageType.DebugReply]: positron.LanguageRuntimeDebugReply;
	// Add message types as needed...
}

export function isLanguageRuntimeMessage<T extends keyof LanguageRuntimeMessageTypeMap>(
	message: positron.LanguageRuntimeMessage,
	expectedType: T
): message is LanguageRuntimeMessageTypeMap[T] {
	return message.type === expectedType;
}

export function isUriEqual(a: vscode.Uri, b: vscode.Uri): boolean {
	return a.toString() === b.toString();
}
