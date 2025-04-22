/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../browser/editorBrowser.js';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures.js';
import { CancellationToken, CancellationTokenSource, } from '../../../../base/common/cancellation.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Range } from '../../../common/core/range.js';
import { binarySearch } from '../../../../base/common/arrays.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { ILanguageConfigurationService } from '../../../common/languages/languageConfigurationRegistry.js';
import { StickyModelProvider, IStickyModelProvider } from './stickyScrollModelProvider.js';
import { StickyElement, StickyModel, StickyRange } from './stickyScrollElement.js';

export class StickyLineCandidate {
	constructor(
		public readonly startLineNumber: number,
		public readonly endLineNumber: number,
		public readonly top: number,
		public readonly height: number,
	) { }
}

export interface IStickyLineCandidateProvider {

	dispose(): void;
	getVersionId(): number | undefined;
	update(): Promise<void>;
	getCandidateStickyLinesIntersecting(range: StickyRange): StickyLineCandidate[];
	onDidChangeStickyScroll: Event<void>;

}

export class StickyLineCandidateProvider extends Disposable implements IStickyLineCandidateProvider {

	static readonly ID = 'store.contrib.stickyScrollController';

	private readonly _onDidChangeStickyScroll = this._register(new Emitter<void>());
	public readonly onDidChangeStickyScroll = this._onDidChangeStickyScroll.event;

	private readonly _editor: ICodeEditor;
	private readonly _updateSoon: RunOnceScheduler;
	private readonly _sessionStore: DisposableStore;

	private _model: StickyModel | null = null;
	private _cts: CancellationTokenSource | null = null;
	private _stickyModelProvider: IStickyModelProvider | null = null;

	constructor(
		editor: ICodeEditor,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ILanguageConfigurationService private readonly _languageConfigurationService: ILanguageConfigurationService,
	) {
		super();
		this._editor = editor;
		this._sessionStore = this._register(new DisposableStore());
		this._updateSoon = this._register(new RunOnceScheduler(() => this.update(), 50));

		this._register(this._editor.onDidChangeConfiguration(e => {
			if (e.hasChanged(EditorOption.stickyScroll)) {
				this.readConfiguration();
			}
		}));
		this.readConfiguration();
	}

	private readConfiguration() {
		this._sessionStore.clear();
		const options = this._editor.getOption(EditorOption.stickyScroll);
		if (!options.enabled) {
			return;
		}
		this._sessionStore.add(this._editor.onDidChangeModel(() => {
			// We should not show an old model for a different file, it will always be wrong.
			// So we clear the model here immediately and then trigger an update.
			this._model = null;
			this.updateStickyModelProvider();
			this._onDidChangeStickyScroll.fire();

			this.update();
		}));
		this._sessionStore.add(this._editor.onDidChangeHiddenAreas(() => this.update()));
		this._sessionStore.add(this._editor.onDidChangeModelContent(() => this._updateSoon.schedule()));
		this._sessionStore.add(this._languageFeaturesService.documentSymbolProvider.onDidChange(() => this.update()));
		this._sessionStore.add(toDisposable(() => {
			this._stickyModelProvider?.dispose();
			this._stickyModelProvider = null;
		}));
		this.updateStickyModelProvider();
		this.update();
	}

	public getVersionId(): number | undefined {
		return this._model?.version;
	}

	private updateStickyModelProvider() {
		this._stickyModelProvider?.dispose();
		this._stickyModelProvider = null;
		const editor = this._editor;
		if (editor.hasModel()) {
			this._stickyModelProvider = new StickyModelProvider(
				editor,
				() => this._updateSoon.schedule(),
				this._languageConfigurationService,
				this._languageFeaturesService
			);
		}
	}

	public async update(): Promise<void> {
		this._cts?.dispose(true);
		this._cts = new CancellationTokenSource();
		await this.updateStickyModel(this._cts.token);
		this._onDidChangeStickyScroll.fire();
	}

	private async updateStickyModel(token: CancellationToken): Promise<void> {
		if (!this._editor.hasModel() || !this._stickyModelProvider || this._editor.getModel().isTooLargeForTokenization()) {
			this._model = null;
			return;
		}
		const model = await this._stickyModelProvider.update(token);
		if (token.isCancellationRequested) {
			// the computation was canceled, so do not overwrite the model
			return;
		}
		this._model = model;
	}

	private updateIndex(index: number) {
		if (index === -1) {
			index = 0;
		} else if (index < 0) {
			index = -index - 2;
		}
		return index;
	}

	public getCandidateStickyLinesIntersectingFromStickyModel(
		range: StickyRange,
		outlineModel: StickyElement,
		result: StickyLineCandidate[],
		depth: number,
		top: number,
		lastStartLineNumber: number
	): void {
		if (outlineModel.children.length === 0) {
			return;
		}
		let lastLine = lastStartLineNumber;
		const childrenStartLines: number[] = [];

		for (let i = 0; i < outlineModel.children.length; i++) {
			const child = outlineModel.children[i];
			if (child.range) {
				childrenStartLines.push(child.range.startLineNumber);
			}
		}
		const lowerBound = this.updateIndex(binarySearch(childrenStartLines, range.startLineNumber, (a: number, b: number) => { return a - b; }));
		const upperBound = this.updateIndex(binarySearch(childrenStartLines, range.startLineNumber + depth, (a: number, b: number) => { return a - b; }));

		for (let i = lowerBound; i <= upperBound; i++) {
			const child = outlineModel.children[i];
			if (!child) {
				return;
			}
			const childRange = child.range;
			if (childRange) {
				const childStartLine = childRange.startLineNumber;
				const childEndLine = childRange.endLineNumber;
				if (range.startLineNumber <= childEndLine + 1 && childStartLine - 1 <= range.endLineNumber && childStartLine !== lastLine) {
					lastLine = childStartLine;
					const lineHeight = this._editor.getOption(EditorOption.lineHeight);
					result.push(new StickyLineCandidate(childStartLine, childEndLine - 1, top, lineHeight));
					this.getCandidateStickyLinesIntersectingFromStickyModel(range, child, result, depth + 1, top + lineHeight, childStartLine);
				}
			} else {
				this.getCandidateStickyLinesIntersectingFromStickyModel(range, child, result, depth, top, lastStartLineNumber);
			}
		}
	}

	public getCandidateStickyLinesIntersecting(range: StickyRange): StickyLineCandidate[] {
		if (!this._model?.element) {
			return [];
		}
		let stickyLineCandidates: StickyLineCandidate[] = [];
		this.getCandidateStickyLinesIntersectingFromStickyModel(range, this._model.element, stickyLineCandidates, 0, 0, -1);
		const hiddenRanges: Range[] | undefined = this._editor._getViewModel()?.getHiddenAreas();

		if (hiddenRanges) {
			for (const hiddenRange of hiddenRanges) {
				stickyLineCandidates = stickyLineCandidates.filter(stickyLine => !(stickyLine.startLineNumber >= hiddenRange.startLineNumber && stickyLine.endLineNumber <= hiddenRange.endLineNumber + 1));
			}
		}
		return stickyLineCandidates;
	}
}
