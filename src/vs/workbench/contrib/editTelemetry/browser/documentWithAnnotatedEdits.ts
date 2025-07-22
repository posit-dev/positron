/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableObject, raceTimeout } from '../../../../base/common/async.js';
import { CachedFunction } from '../../../../base/common/cache.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { IObservableWithChange, ISettableObservable, observableValue, RemoveUndefined, runOnChange } from '../../../../base/common/observable.js';
import { AnnotatedStringEdit, IEditData } from '../../../../editor/common/core/edits/stringEdit.js';
import { StringText } from '../../../../editor/common/core/text/abstractText.js';
import { IEditorWorkerService } from '../../../../editor/common/services/editorWorker.js';
import { TextModelEditReason } from '../../../../editor/common/textModelEditReason.js';
import { IObservableDocument } from './observableWorkspace.js';

export interface IDocumentWithAnnotatedEdits<TEditData extends IEditData<TEditData> = EditSourceData> {
	readonly value: IObservableWithChange<StringText, { edit: AnnotatedStringEdit<TEditData> }>;
	waitForQueue(): Promise<void>;
}

/**
 * Creates a document that is a delayed copy of the original document,
 * but with edits annotated with the source of the edit.
*/
export class DocumentWithAnnotatedEdits extends Disposable implements IDocumentWithAnnotatedEdits<EditReasonData> {
	public readonly value: IObservableWithChange<StringText, { edit: AnnotatedStringEdit<EditReasonData> }>;

	constructor(private readonly _originalDoc: IObservableDocument) {
		super();

		const v = this.value = observableValue(this, _originalDoc.value.get());

		this._register(runOnChange(this._originalDoc.value, (val, _prevVal, edits) => {
			const eComposed = AnnotatedStringEdit.compose(edits.map(e => {
				const editSourceData = new EditReasonData(e.reason);
				return e.mapData(() => editSourceData);
			}));

			v.set(val, undefined, { edit: eComposed });
		}));
	}

	public waitForQueue(): Promise<void> {
		return Promise.resolve();
	}
}

/**
 * Only joins touching edits if the source and the metadata is the same.
*/
export class EditReasonData implements IEditData<EditReasonData> {
	public readonly source;
	public readonly key;

	constructor(
		public readonly editReason: TextModelEditReason
	) {
		this.key = this.editReason.toKey(1);
		this.source = EditSourceBase.create(this.editReason);
	}

	join(data: EditReasonData): EditReasonData | undefined {
		if (this.editReason !== data.editReason) {
			return undefined;
		}
		return this;
	}

	toEditSourceData(): EditSourceData {
		return new EditSourceData(this.key, this.source);
	}
}

export class EditSourceData implements IEditData<EditSourceData> {
	constructor(
		public readonly key: string,
		public readonly source: EditSource,
	) { }

	join(data: EditSourceData): EditSourceData | undefined {
		if (this.key !== data.key) {
			return undefined;
		}
		if (this.source !== data.source) {
			return undefined;
		}
		return this;
	}
}

export abstract class EditSourceBase {
	private static _cache = new CachedFunction({ getCacheKey: v => v.toString() }, (arg: EditSource) => arg);

	public static create(reason: TextModelEditReason): EditSource {
		const data = reason.metadata;
		switch (data.source) {
			case 'reloadFromDisk':
				return this._cache.get(new ExternalEditSource());
			case 'inlineCompletionPartialAccept':
			case 'inlineCompletionAccept': {
				const type = 'type' in data ? data.type : undefined;
				if ('$nes' in data && data.$nes) {
					return this._cache.get(new InlineSuggestEditSource('nes', data.$extensionId ?? '', type));
				}
				return this._cache.get(new InlineSuggestEditSource('completion', data.$extensionId ?? '', type));
			}
			case 'snippet':
				return this._cache.get(new IdeEditSource('suggest'));
			case 'unknown':
				if (!data.name) {
					return this._cache.get(new UnknownEditSource());
				}
				switch (data.name) {
					case 'formatEditsCommand':
						return this._cache.get(new IdeEditSource('format'));
				}
				return this._cache.get(new UnknownEditSource());

			case 'Chat.applyEdits':
				return this._cache.get(new ChatEditSource('sidebar'));
			case 'inlineChat.applyEdits':
				return this._cache.get(new ChatEditSource('inline'));
			case 'cursor':
				return this._cache.get(new UserEditSource());
			default:
				return this._cache.get(new UnknownEditSource());
		}
	}

	public abstract getColor(): string;
}

export type EditSource = InlineSuggestEditSource | ChatEditSource | IdeEditSource | UserEditSource | UnknownEditSource | ExternalEditSource;

export class InlineSuggestEditSource extends EditSourceBase {
	public readonly category = 'ai';
	public readonly feature = 'inlineSuggest';
	constructor(
		public readonly kind: 'completion' | 'nes',
		public readonly extensionId: string,
		public readonly type: 'word' | 'line' | undefined,
	) { super(); }

	override toString() { return `${this.category}/${this.feature}/${this.kind}/${this.extensionId}/${this.type}`; }

	public getColor(): string { return '#00ff0033'; }
}

class ChatEditSource extends EditSourceBase {
	public readonly category = 'ai';
	public readonly feature = 'chat';
	constructor(
		public readonly kind: 'sidebar' | 'inline',
	) { super(); }

	override toString() { return `${this.category}/${this.feature}/${this.kind}`; }

	public getColor(): string { return '#00ff0066'; }
}

class IdeEditSource extends EditSourceBase {
	public readonly category = 'ide';
	constructor(
		public readonly feature: 'suggest' | 'format' | string,
	) { super(); }

	override toString() { return `${this.category}/${this.feature}`; }

	public getColor(): string { return this.feature === 'format' ? '#0000ff33' : '#80808033'; }
}

class UserEditSource extends EditSourceBase {
	public readonly category = 'user';
	constructor() { super(); }

	override toString() { return this.category; }

	public getColor(): string { return '#d3d3d333'; }
}

/** Caused by external tools that trigger a reload from disk */
class ExternalEditSource extends EditSourceBase {
	public readonly category = 'external';
	constructor() { super(); }

	override toString() { return this.category; }

	public getColor(): string { return '#009ab254'; }
}

class UnknownEditSource extends EditSourceBase {
	public readonly category = 'unknown';
	constructor() { super(); }

	override toString() { return this.category; }

	public getColor(): string { return '#ff000033'; }
}

export class CombineStreamedChanges<TEditData extends EditSourceData & IEditData<TEditData>> extends Disposable implements IDocumentWithAnnotatedEdits<TEditData> {
	private readonly _value: ISettableObservable<StringText, { edit: AnnotatedStringEdit<TEditData> }>;
	readonly value: IObservableWithChange<StringText, { edit: AnnotatedStringEdit<TEditData> }>;
	private readonly _runStore = this._register(new DisposableStore());
	private _runQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly _originalDoc: IDocumentWithAnnotatedEdits<TEditData>,
		@IEditorWorkerService private readonly _diffService: IEditorWorkerService,
	) {
		super();

		this.value = this._value = observableValue(this, _originalDoc.value.get());
		this._restart();

		this._diffService.computeStringEditFromDiff('foo', 'last.value.value', { maxComputationTimeMs: 500 }, 'advanced');
	}

	async _restart(): Promise<void> {
		this._runStore.clear();
		const iterator = iterateChangesFromObservable(this._originalDoc.value, this._runStore)[Symbol.asyncIterator]();
		const p = this._runQueue;
		this._runQueue = this._runQueue.then(() => this._run(iterator));
		await p;
	}

	private async _run(iterator: AsyncIterator<{ value: StringText; prevValue: StringText; change: { edit: AnnotatedStringEdit<TEditData> }[] }, any, any>) {
		const reader = new AsyncReader(iterator);
		while (true) {
			let peeked = await reader.peek();
			if (peeked === AsyncReaderEndOfStream) {
				return;
			} else if (isChatEdit(peeked)) {
				const first = peeked;

				let last = first;
				let chatEdit = AnnotatedStringEdit.empty as AnnotatedStringEdit<TEditData>;

				do {
					reader.readSyncOrThrow();
					last = peeked;
					chatEdit = chatEdit.compose(AnnotatedStringEdit.compose(peeked.change.map(c => c.edit)));
					if (!await reader.waitForBufferTimeout(1000)) {
						break;
					}
					peeked = reader.peekSyncOrThrow();
				} while (peeked !== AsyncReaderEndOfStream && isChatEdit(peeked));

				if (!chatEdit.isEmpty()) {
					const data = chatEdit.replacements[0].data;
					const diffEdit = await this._diffService.computeStringEditFromDiff(first.prevValue.value, last.value.value, { maxComputationTimeMs: 500 }, 'advanced');
					const edit = diffEdit.mapData(_e => data);
					this._value.set(last.value, undefined, { edit });
				}
			} else {
				reader.readSyncOrThrow();
				const e = AnnotatedStringEdit.compose(peeked.change.map(c => c.edit));
				this._value.set(peeked.value, undefined, { edit: e });
			}
		}
	}

	async waitForQueue(): Promise<void> {
		await this._originalDoc.waitForQueue();
		await this._restart();
	}
}

function isChatEdit(next: { value: StringText; change: { edit: AnnotatedStringEdit<EditSourceData> }[] }) {
	return next.change.every(c => c.edit.replacements.every(e => {
		if (e.data.source.category === 'ai' && e.data.source.feature === 'chat') {
			return true;
		}
		return false;
	}));
}

function iterateChangesFromObservable<T, TChange>(obs: IObservableWithChange<T, TChange>, store: DisposableStore): AsyncIterable<{ value: T; prevValue: T; change: RemoveUndefined<TChange>[] }> {
	return new AsyncIterableObject<{ value: T; prevValue: T; change: RemoveUndefined<TChange>[] }>((e) => {
		store.add(runOnChange(obs, (value, prevValue, change) => {
			e.emitOne({ value, prevValue, change: change });
		}));

		return new Promise((res) => {
			store.add(toDisposable(() => {
				res(undefined);
			}));
		});
	});
}

export class MinimizeEditsProcessor<TEditData extends IEditData<TEditData>> extends Disposable implements IDocumentWithAnnotatedEdits<TEditData> {
	readonly value: IObservableWithChange<StringText, { edit: AnnotatedStringEdit<TEditData> }>;

	constructor(
		private readonly _originalDoc: IDocumentWithAnnotatedEdits<TEditData>,
	) {
		super();

		const v = this.value = observableValue(this, _originalDoc.value.get());

		let prevValue: string = this._originalDoc.value.get().value;
		this._register(runOnChange(this._originalDoc.value, (val, _prevVal, edits) => {
			const eComposed = AnnotatedStringEdit.compose(edits.map(e => e.edit));

			const e = eComposed.removeCommonSuffixAndPrefix(prevValue);
			prevValue = val.value;

			v.set(val, undefined, { edit: e });
		}));
	}

	async waitForQueue(): Promise<void> {
		await this._originalDoc.waitForQueue();
	}
}

export const AsyncReaderEndOfStream = Symbol('AsyncReaderEndOfStream');

export class AsyncReader<T> {
	private _buffer: T[] = [];
	private _atEnd = false;

	public get endOfStream(): boolean { return this._buffer.length === 0 && this._atEnd; }

	constructor(
		private readonly _source: AsyncIterator<T>
	) {
	}

	private async _extendBuffer(): Promise<void> {
		if (this._atEnd) {
			return;
		}
		const { value, done } = await this._source.next();
		if (done) {
			this._atEnd = true;
		} else {
			this._buffer.push(value);
		}
	}

	public async peek(): Promise<T | typeof AsyncReaderEndOfStream> {
		if (this._buffer.length === 0 && !this._atEnd) {
			await this._extendBuffer();
		}
		if (this._buffer.length === 0) {
			return AsyncReaderEndOfStream;
		}
		return this._buffer[0];
	}

	public peekSyncOrThrow(): T | typeof AsyncReaderEndOfStream {
		if (this._buffer.length === 0) {
			if (this._atEnd) {
				return AsyncReaderEndOfStream;
			}
			throw new Error('No more elements');
		}

		return this._buffer[0];
	}

	public readSyncOrThrow(): T | typeof AsyncReaderEndOfStream {
		if (this._buffer.length === 0) {
			if (this._atEnd) {
				return AsyncReaderEndOfStream;
			}
			throw new Error('No more elements');
		}

		return this._buffer.shift()!;
	}

	public async peekNextTimeout(timeoutMs: number): Promise<T | typeof AsyncReaderEndOfStream | undefined> {
		if (this._buffer.length === 0 && !this._atEnd) {
			await raceTimeout(this._extendBuffer(), timeoutMs);
		}
		if (this._atEnd) {
			return AsyncReaderEndOfStream;
		}
		if (this._buffer.length === 0) {
			return undefined;
		}
		return this._buffer[0];
	}

	public async waitForBufferTimeout(timeoutMs: number): Promise<boolean> {
		if (this._buffer.length > 0 || this._atEnd) {
			return true;
		}
		const result = await raceTimeout(this._extendBuffer().then(() => true), timeoutMs);
		return result !== undefined;
	}

	public async read(): Promise<T | typeof AsyncReaderEndOfStream> {
		if (this._buffer.length === 0 && !this._atEnd) {
			await this._extendBuffer();
		}
		if (this._buffer.length === 0) {
			return AsyncReaderEndOfStream;
		}
		return this._buffer.shift()!;
	}

	public async readWhile(predicate: (value: T) => boolean, callback: (element: T) => unknown): Promise<void> {
		do {
			const piece = await this.peek();
			if (piece === AsyncReaderEndOfStream) {
				break;
			}
			if (!predicate(piece)) {
				break;
			}
			await this.read(); // consume
			await callback(piece);
		} while (true);
	}

	public async consumeToEnd(): Promise<void> {
		while (!this.endOfStream) {
			await this.read();
		}
	}
}
