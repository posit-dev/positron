/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Disposable } from '../../../../base/common/lifecycle.js';
import { observableSignal, runOnChange, IReader } from '../../../../base/common/observable.js';
import { AnnotatedStringEdit } from '../../../../editor/common/core/edits/stringEdit.js';
import { OffsetRange } from '../../../../editor/common/core/ranges/offsetRange.js';
import { IDocumentWithAnnotatedEdits, EditSourceData, EditSource } from './documentWithAnnotatedEdits.js';

/**
 * Tracks a single document.
*/
export class DocumentEditSourceTracker<T = void> extends Disposable {
	private _edits: AnnotatedStringEdit<EditSourceData> = AnnotatedStringEdit.empty;
	private _pendingExternalEdits: AnnotatedStringEdit<EditSourceData> = AnnotatedStringEdit.empty;

	private readonly _update = observableSignal(this);

	constructor(
		private readonly _doc: IDocumentWithAnnotatedEdits,
		public readonly data: T,
	) {
		super();

		this._register(runOnChange(this._doc.value, (_val, _prevVal, edits) => {
			const eComposed = AnnotatedStringEdit.compose(edits.map(e => e.edit));
			if (eComposed.replacements.every(e => e.data.source.category === 'external')) {
				if (this._edits.isEmpty()) {
					// Ignore initial external edits
				} else {
					// queue pending external edits
					this._pendingExternalEdits = this._pendingExternalEdits.compose(eComposed);
				}
			} else {
				if (!this._pendingExternalEdits.isEmpty()) {
					this._edits = this._edits.compose(this._pendingExternalEdits);
					this._pendingExternalEdits = AnnotatedStringEdit.empty;
				}
				this._edits = this._edits.compose(eComposed);
			}

			this._update.trigger(undefined);
		}));
	}

	async waitForQueue(): Promise<void> {
		await this._doc.waitForQueue();
	}

	getTrackedRanges(reader?: IReader): TrackedEdit[] {
		this._update.read(reader);
		const ranges = this._edits.getNewRanges();
		return ranges.map((r, idx) => {
			const e = this._edits.replacements[idx];
			const reason = e.data.source;
			const te = new TrackedEdit(e.replaceRange, r, reason, e.data.key);
			return te;
		});
	}

	isEmpty(): boolean {
		return this._edits.isEmpty();
	}

	public reset(): void {
		this._edits = AnnotatedStringEdit.empty;
	}

	public _getDebugVisualization() {
		const ranges = this.getTrackedRanges();
		const txt = this._doc.value.get().value;

		return {
			...{ $fileExtension: 'text.w' },
			'value': txt,
			'decorations': ranges.map(r => {
				return {
					range: [r.range.start, r.range.endExclusive],
					color: r.source.getColor(),
				};
			})
		};
	}
}

export class TrackedEdit {
	constructor(
		public readonly originalRange: OffsetRange,
		public readonly range: OffsetRange,
		public readonly source: EditSource,
		public readonly sourceKey: string,
	) { }
}
