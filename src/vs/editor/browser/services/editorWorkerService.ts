/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from 'vs/base/common/async';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { logOnceWebWorkerWarning, IWorkerClient, Proxied, IWorkerDescriptor } from 'vs/base/common/worker/simpleWorker';
import { createWebWorker } from 'vs/base/browser/defaultWorkerFactory';
import { Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { ITextModel } from 'vs/editor/common/model';
import * as languages from 'vs/editor/common/languages';
import { ILanguageConfigurationService } from 'vs/editor/common/languages/languageConfigurationRegistry';
import { EditorSimpleWorker } from 'vs/editor/common/services/editorSimpleWorker';
import { DiffAlgorithmName, IEditorWorkerService, ILineChange, IUnicodeHighlightsResult } from 'vs/editor/common/services/editorWorker';
import { IModelService } from 'vs/editor/common/services/model';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfiguration';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { ILogService } from 'vs/platform/log/common/log';
import { StopWatch } from 'vs/base/common/stopwatch';
import { canceled, onUnexpectedError } from 'vs/base/common/errors';
import { UnicodeHighlighterOptions } from 'vs/editor/common/services/unicodeTextModelHighlighter';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import { IChange } from 'vs/editor/common/diff/legacyLinesDiffComputer';
import { IDocumentDiff, IDocumentDiffProviderOptions } from 'vs/editor/common/diff/documentDiffProvider';
import { ILinesDiffComputerOptions, MovedText } from 'vs/editor/common/diff/linesDiffComputer';
import { DetailedLineRangeMapping, RangeMapping, LineRangeMapping } from 'vs/editor/common/diff/rangeMapping';
import { LineRange } from 'vs/editor/common/core/lineRange';
import { SectionHeader, FindSectionHeaderOptions } from 'vs/editor/common/services/findSectionHeaders';
import { mainWindow } from 'vs/base/browser/window';
import { WindowIntervalTimer } from 'vs/base/browser/dom';
import { WorkerTextModelSyncClient } from 'vs/editor/common/services/textModelSync/textModelSync.impl';
import { EditorWorkerHost } from 'vs/editor/common/services/editorWorkerHost';

/**
 * Stop the worker if it was not needed for 5 min.
 */
const STOP_WORKER_DELTA_TIME_MS = 5 * 60 * 1000;

function canSyncModel(modelService: IModelService, resource: URI): boolean {
	const model = modelService.getModel(resource);
	if (!model) {
		return false;
	}
	if (model.isTooLargeForSyncing()) {
		return false;
	}
	return true;
}

export abstract class EditorWorkerService extends Disposable implements IEditorWorkerService {

	declare readonly _serviceBrand: undefined;

	private readonly _modelService: IModelService;
	private readonly _workerManager: WorkerManager;
	private readonly _logService: ILogService;

	constructor(
		workerDescriptor: IWorkerDescriptor,
		@IModelService modelService: IModelService,
		@ITextResourceConfigurationService configurationService: ITextResourceConfigurationService,
		@ILogService logService: ILogService,
		@ILanguageConfigurationService private readonly _languageConfigurationService: ILanguageConfigurationService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
	) {
		super();
		this._modelService = modelService;
		this._workerManager = this._register(new WorkerManager(workerDescriptor, this._modelService));
		this._logService = logService;

		// register default link-provider and default completions-provider
		this._register(languageFeaturesService.linkProvider.register({ language: '*', hasAccessToAllModels: true }, {
			provideLinks: async (model, token) => {
				if (!canSyncModel(this._modelService, model.uri)) {
					return Promise.resolve({ links: [] }); // File too large
				}
				const worker = await this._workerWithResources([model.uri]);
				const links = await worker.$computeLinks(model.uri.toString());
				return links && { links };
			}
		}));
		this._register(languageFeaturesService.completionProvider.register('*', new WordBasedCompletionItemProvider(this._workerManager, configurationService, this._modelService, this._languageConfigurationService)));
	}

	public override dispose(): void {
		super.dispose();
	}

	public canComputeUnicodeHighlights(uri: URI): boolean {
		return canSyncModel(this._modelService, uri);
	}

	public async computedUnicodeHighlights(uri: URI, options: UnicodeHighlighterOptions, range?: IRange): Promise<IUnicodeHighlightsResult> {
		const worker = await this._workerWithResources([uri]);
		return worker.$computeUnicodeHighlights(uri.toString(), options, range);
	}

	public async computeDiff(original: URI, modified: URI, options: IDocumentDiffProviderOptions, algorithm: DiffAlgorithmName): Promise<IDocumentDiff | null> {
		const worker = await this._workerWithResources([original, modified], /* forceLargeModels */true);
		const result = await worker.$computeDiff(original.toString(), modified.toString(), options, algorithm);
		if (!result) {
			return null;
		}
		// Convert from space efficient JSON data to rich objects.
		const diff: IDocumentDiff = {
			identical: result.identical,
			quitEarly: result.quitEarly,
			changes: toLineRangeMappings(result.changes),
			moves: result.moves.map(m => new MovedText(
				new LineRangeMapping(new LineRange(m[0], m[1]), new LineRange(m[2], m[3])),
				toLineRangeMappings(m[4])
			))
		};
		return diff;

		function toLineRangeMappings(changes: readonly ILineChange[]): readonly DetailedLineRangeMapping[] {
			return changes.map(
				(c) => new DetailedLineRangeMapping(
					new LineRange(c[0], c[1]),
					new LineRange(c[2], c[3]),
					c[4]?.map(
						(c) => new RangeMapping(
							new Range(c[0], c[1], c[2], c[3]),
							new Range(c[4], c[5], c[6], c[7])
						)
					)
				)
			);
		}
	}

	public canComputeDirtyDiff(original: URI, modified: URI): boolean {
		return (canSyncModel(this._modelService, original) && canSyncModel(this._modelService, modified));
	}

	public async computeDirtyDiff(original: URI, modified: URI, ignoreTrimWhitespace: boolean): Promise<IChange[] | null> {
		const worker = await this._workerWithResources([original, modified]);
		return worker.$computeDirtyDiff(original.toString(), modified.toString(), ignoreTrimWhitespace);
	}

	public async computeMoreMinimalEdits(resource: URI, edits: languages.TextEdit[] | null | undefined, pretty: boolean = false): Promise<languages.TextEdit[] | undefined> {
		if (isNonEmptyArray(edits)) {
			if (!canSyncModel(this._modelService, resource)) {
				return Promise.resolve(edits); // File too large
			}
			const sw = StopWatch.create();
			const result = this._workerWithResources([resource]).then(worker => worker.$computeMoreMinimalEdits(resource.toString(), edits, pretty));
			result.finally(() => this._logService.trace('FORMAT#computeMoreMinimalEdits', resource.toString(true), sw.elapsed()));
			return Promise.race([result, timeout(1000).then(() => edits)]);

		} else {
			return Promise.resolve(undefined);
		}
	}

	public computeHumanReadableDiff(resource: URI, edits: languages.TextEdit[] | null | undefined): Promise<languages.TextEdit[] | undefined> {
		if (isNonEmptyArray(edits)) {
			if (!canSyncModel(this._modelService, resource)) {
				return Promise.resolve(edits); // File too large
			}
			const sw = StopWatch.create();
			const opts: ILinesDiffComputerOptions = { ignoreTrimWhitespace: false, maxComputationTimeMs: 1000, computeMoves: false };
			const result = (
				this._workerWithResources([resource])
					.then(worker => worker.$computeHumanReadableDiff(resource.toString(), edits, opts))
					.catch((err) => {
						onUnexpectedError(err);
						// In case of an exception, fall back to computeMoreMinimalEdits
						return this.computeMoreMinimalEdits(resource, edits, true);
					})
			);
			result.finally(() => this._logService.trace('FORMAT#computeHumanReadableDiff', resource.toString(true), sw.elapsed()));
			return result;

		} else {
			return Promise.resolve(undefined);
		}
	}

	public canNavigateValueSet(resource: URI): boolean {
		return (canSyncModel(this._modelService, resource));
	}

	public async navigateValueSet(resource: URI, range: IRange, up: boolean): Promise<languages.IInplaceReplaceSupportResult | null> {
		const model = this._modelService.getModel(resource);
		if (!model) {
			return null;
		}
		const wordDefRegExp = this._languageConfigurationService.getLanguageConfiguration(model.getLanguageId()).getWordDefinition();
		const wordDef = wordDefRegExp.source;
		const wordDefFlags = wordDefRegExp.flags;
		const worker = await this._workerWithResources([resource]);
		return worker.$navigateValueSet(resource.toString(), range, up, wordDef, wordDefFlags);
	}

	public canComputeWordRanges(resource: URI): boolean {
		return canSyncModel(this._modelService, resource);
	}

	public async computeWordRanges(resource: URI, range: IRange): Promise<{ [word: string]: IRange[] } | null> {
		const model = this._modelService.getModel(resource);
		if (!model) {
			return Promise.resolve(null);
		}
		const wordDefRegExp = this._languageConfigurationService.getLanguageConfiguration(model.getLanguageId()).getWordDefinition();
		const wordDef = wordDefRegExp.source;
		const wordDefFlags = wordDefRegExp.flags;
		const worker = await this._workerWithResources([resource]);
		return worker.$computeWordRanges(resource.toString(), range, wordDef, wordDefFlags);
	}

	public async findSectionHeaders(uri: URI, options: FindSectionHeaderOptions): Promise<SectionHeader[]> {
		const worker = await this._workerWithResources([uri]);
		return worker.$findSectionHeaders(uri.toString(), options);
	}

	public async computeDefaultDocumentColors(uri: URI): Promise<languages.IColorInformation[] | null> {
		const worker = await this._workerWithResources([uri]);
		return worker.$computeDefaultDocumentColors(uri.toString());
	}

	private async _workerWithResources(resources: URI[], forceLargeModels: boolean = false): Promise<Proxied<EditorSimpleWorker>> {
		const worker = await this._workerManager.withWorker();
		return await worker.workerWithSyncedResources(resources, forceLargeModels);
	}
}

class WordBasedCompletionItemProvider implements languages.CompletionItemProvider {

	private readonly _workerManager: WorkerManager;
	private readonly _configurationService: ITextResourceConfigurationService;
	private readonly _modelService: IModelService;

	readonly _debugDisplayName = 'wordbasedCompletions';

	constructor(
		workerManager: WorkerManager,
		configurationService: ITextResourceConfigurationService,
		modelService: IModelService,
		private readonly languageConfigurationService: ILanguageConfigurationService
	) {
		this._workerManager = workerManager;
		this._configurationService = configurationService;
		this._modelService = modelService;
	}

	async provideCompletionItems(model: ITextModel, position: Position): Promise<languages.CompletionList | undefined> {
		type WordBasedSuggestionsConfig = {
			wordBasedSuggestions?: 'off' | 'currentDocument' | 'matchingDocuments' | 'allDocuments';
		};
		const config = this._configurationService.getValue<WordBasedSuggestionsConfig>(model.uri, position, 'editor');
		if (config.wordBasedSuggestions === 'off') {
			return undefined;
		}

		const models: URI[] = [];
		if (config.wordBasedSuggestions === 'currentDocument') {
			// only current file and only if not too large
			if (canSyncModel(this._modelService, model.uri)) {
				models.push(model.uri);
			}
		} else {
			// either all files or files of same language
			for (const candidate of this._modelService.getModels()) {
				if (!canSyncModel(this._modelService, candidate.uri)) {
					continue;
				}
				if (candidate === model) {
					models.unshift(candidate.uri);

				} else if (config.wordBasedSuggestions === 'allDocuments' || candidate.getLanguageId() === model.getLanguageId()) {
					models.push(candidate.uri);
				}
			}
		}

		if (models.length === 0) {
			return undefined; // File too large, no other files
		}

		const wordDefRegExp = this.languageConfigurationService.getLanguageConfiguration(model.getLanguageId()).getWordDefinition();
		const word = model.getWordAtPosition(position);
		const replace = !word ? Range.fromPositions(position) : new Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
		const insert = replace.setEndPosition(position.lineNumber, position.column);

		const client = await this._workerManager.withWorker();
		const data = await client.textualSuggest(models, word?.word, wordDefRegExp);
		if (!data) {
			return undefined;
		}

		return {
			duration: data.duration,
			suggestions: data.words.map((word): languages.CompletionItem => {
				return {
					kind: languages.CompletionItemKind.Text,
					label: word,
					insertText: word,
					range: { insert, replace }
				};
			}),
		};
	}
}

class WorkerManager extends Disposable {

	private readonly _modelService: IModelService;
	private _editorWorkerClient: EditorWorkerClient | null;
	private _lastWorkerUsedTime: number;

	constructor(
		private readonly _workerDescriptor: IWorkerDescriptor,
		@IModelService modelService: IModelService
	) {
		super();
		this._modelService = modelService;
		this._editorWorkerClient = null;
		this._lastWorkerUsedTime = (new Date()).getTime();

		const stopWorkerInterval = this._register(new WindowIntervalTimer());
		stopWorkerInterval.cancelAndSet(() => this._checkStopIdleWorker(), Math.round(STOP_WORKER_DELTA_TIME_MS / 2), mainWindow);

		this._register(this._modelService.onModelRemoved(_ => this._checkStopEmptyWorker()));
	}

	public override dispose(): void {
		if (this._editorWorkerClient) {
			this._editorWorkerClient.dispose();
			this._editorWorkerClient = null;
		}
		super.dispose();
	}

	/**
	 * Check if the model service has no more models and stop the worker if that is the case.
	 */
	private _checkStopEmptyWorker(): void {
		if (!this._editorWorkerClient) {
			return;
		}

		const models = this._modelService.getModels();
		if (models.length === 0) {
			// There are no more models => nothing possible for me to do
			this._editorWorkerClient.dispose();
			this._editorWorkerClient = null;
		}
	}

	/**
	 * Check if the worker has been idle for a while and then stop it.
	 */
	private _checkStopIdleWorker(): void {
		if (!this._editorWorkerClient) {
			return;
		}

		const timeSinceLastWorkerUsedTime = (new Date()).getTime() - this._lastWorkerUsedTime;
		if (timeSinceLastWorkerUsedTime > STOP_WORKER_DELTA_TIME_MS) {
			this._editorWorkerClient.dispose();
			this._editorWorkerClient = null;
		}
	}

	public withWorker(): Promise<EditorWorkerClient> {
		this._lastWorkerUsedTime = (new Date()).getTime();
		if (!this._editorWorkerClient) {
			this._editorWorkerClient = new EditorWorkerClient(this._workerDescriptor, false, this._modelService);
		}
		return Promise.resolve(this._editorWorkerClient);
	}
}

class SynchronousWorkerClient<T extends IDisposable> implements IWorkerClient<T> {
	private readonly _instance: T;
	public readonly proxy: Proxied<T>;

	constructor(instance: T) {
		this._instance = instance;
		this.proxy = this._instance as Proxied<T>;
	}

	public dispose(): void {
		this._instance.dispose();
	}

	public setChannel<T extends object>(channel: string, handler: T): void {
		throw new Error(`Not supported`);
	}

	public getChannel<T extends object>(channel: string): Proxied<T> {
		throw new Error(`Not supported`);
	}
}

export interface IEditorWorkerClient {
	fhr(method: string, args: any[]): Promise<any>;
}

export class EditorWorkerClient extends Disposable implements IEditorWorkerClient {

	private readonly _modelService: IModelService;
	private readonly _keepIdleModels: boolean;
	private _worker: IWorkerClient<EditorSimpleWorker> | null;
	private _modelManager: WorkerTextModelSyncClient | null;
	private _disposed = false;

	constructor(
		private readonly _workerDescriptor: IWorkerDescriptor,
		keepIdleModels: boolean,
		@IModelService modelService: IModelService,
	) {
		super();
		this._modelService = modelService;
		this._keepIdleModels = keepIdleModels;
		this._worker = null;
		this._modelManager = null;
	}

	// foreign host request
	public fhr(method: string, args: any[]): Promise<any> {
		throw new Error(`Not implemented!`);
	}

	private _getOrCreateWorker(): IWorkerClient<EditorSimpleWorker> {
		if (!this._worker) {
			try {
				this._worker = this._register(createWebWorker<EditorSimpleWorker>(this._workerDescriptor));
				EditorWorkerHost.setChannel(this._worker, this._createEditorWorkerHost());
			} catch (err) {
				logOnceWebWorkerWarning(err);
				this._worker = this._createFallbackLocalWorker();
			}
		}
		return this._worker;
	}

	protected async _getProxy(): Promise<Proxied<EditorSimpleWorker>> {
		try {
			const proxy = this._getOrCreateWorker().proxy;
			await proxy.$ping();
			return proxy;
		} catch (err) {
			logOnceWebWorkerWarning(err);
			this._worker = this._createFallbackLocalWorker();
			return this._worker.proxy;
		}
	}

	private _createFallbackLocalWorker(): SynchronousWorkerClient<EditorSimpleWorker> {
		return new SynchronousWorkerClient(new EditorSimpleWorker(this._createEditorWorkerHost(), null));
	}

	private _createEditorWorkerHost(): EditorWorkerHost {
		return {
			$fhr: (method, args) => this.fhr(method, args)
		};
	}

	private _getOrCreateModelManager(proxy: Proxied<EditorSimpleWorker>): WorkerTextModelSyncClient {
		if (!this._modelManager) {
			this._modelManager = this._register(new WorkerTextModelSyncClient(proxy, this._modelService, this._keepIdleModels));
		}
		return this._modelManager;
	}

	public async workerWithSyncedResources(resources: URI[], forceLargeModels: boolean = false): Promise<Proxied<EditorSimpleWorker>> {
		if (this._disposed) {
			return Promise.reject(canceled());
		}
		const proxy = await this._getProxy();
		this._getOrCreateModelManager(proxy).ensureSyncedResources(resources, forceLargeModels);
		return proxy;
	}

	public async textualSuggest(resources: URI[], leadingWord: string | undefined, wordDefRegExp: RegExp): Promise<{ words: string[]; duration: number } | null> {
		const proxy = await this.workerWithSyncedResources(resources);
		const wordDef = wordDefRegExp.source;
		const wordDefFlags = wordDefRegExp.flags;
		return proxy.$textualSuggest(resources.map(r => r.toString()), leadingWord, wordDef, wordDefFlags);
	}

	override dispose(): void {
		super.dispose();
		this._disposed = true;
	}
}
