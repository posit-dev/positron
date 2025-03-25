/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from '../../../../../base/common/assert.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { IReference, toDisposable } from '../../../../../base/common/lifecycle.js';
import { observableValue, IObservable, ITransaction, autorun, transaction } from '../../../../../base/common/observable.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { themeColorFromId } from '../../../../../base/common/themables.js';
import { assertType } from '../../../../../base/common/types.js';
import { URI } from '../../../../../base/common/uri.js';
import { getCodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ISingleEditOperation, EditOperation } from '../../../../../editor/common/core/editOperation.js';
import { OffsetEdit } from '../../../../../editor/common/core/offsetEdit.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IDocumentDiff, nullDocumentDiff } from '../../../../../editor/common/diff/documentDiffProvider.js';
import { DetailedLineRangeMapping } from '../../../../../editor/common/diff/rangeMapping.js';
import { TextEdit } from '../../../../../editor/common/languages.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { OverviewRulerLane, MinimapPosition, ITextModel, IModelDeltaDecoration } from '../../../../../editor/common/model.js';
import { SingleModelEditStackElement } from '../../../../../editor/common/model/editStack.js';
import { ModelDecorationOptions, createTextBufferFactoryFromSnapshot } from '../../../../../editor/common/model/textModel.js';
import { OffsetEdits } from '../../../../../editor/common/model/textModelOffsetEdit.js';
import { IEditorWorkerService } from '../../../../../editor/common/services/editorWorker.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IModelContentChangedEvent } from '../../../../../editor/common/textModelEvents.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { observableConfigValue } from '../../../../../platform/observable/common/platformObservableUtils.js';
import { editorSelectionBackground } from '../../../../../platform/theme/common/colorRegistry.js';
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { SaveReason, IEditorPane } from '../../../../common/editor.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';
import { IResolvedTextFileEditorModel, stringToSnapshot } from '../../../../services/textfile/common/textfiles.js';
import { ICellEditOperation } from '../../../notebook/common/notebookCommon.js';
import { IModifiedFileEntry, ChatEditKind, WorkingSetEntryState, IModifiedFileEntryEditorIntegration } from '../../common/chatEditingService.js';
import { IChatResponseModel } from '../../common/chatModel.js';
import { IChatService } from '../../common/chatService.js';
import { ChatEditingCodeEditorIntegration, IDocumentDiff2 } from './chatEditingCodeEditorIntegration.js';
import { AbstractChatEditingModifiedFileEntry, pendingRewriteMinimap, IModifiedEntryTelemetryInfo, ISnapshotEntry } from './chatEditingModifiedFileEntry.js';
import { ChatEditingSnapshotTextModelContentProvider, ChatEditingTextModelContentProvider } from './chatEditingTextModelContentProviders.js';


export class ChatEditingModifiedDocumentEntry extends AbstractChatEditingModifiedFileEntry implements IModifiedFileEntry {

	private static readonly _lastEditDecorationOptions = ModelDecorationOptions.register({
		isWholeLine: true,
		description: 'chat-last-edit',
		className: 'chat-editing-last-edit-line',
		marginClassName: 'chat-editing-last-edit',
		overviewRuler: {
			position: OverviewRulerLane.Full,
			color: themeColorFromId(editorSelectionBackground)
		},
	});

	private static readonly _pendingEditDecorationOptions = ModelDecorationOptions.register({
		isWholeLine: true,
		description: 'chat-pending-edit',
		className: 'chat-editing-pending-edit',
		minimap: {
			position: MinimapPosition.Inline,
			color: themeColorFromId(pendingRewriteMinimap)
		}
	});

	readonly initialContent: string;

	private readonly docSnapshot: ITextModel;
	private readonly doc: ITextModel;
	readonly docFileEditorModel: IResolvedTextFileEditorModel;

	get originalModel(): ITextModel {
		return this.docSnapshot;
	}

	get modifiedModel(): ITextModel {
		return this.doc;
	}

	private _edit: OffsetEdit = OffsetEdit.empty;
	private _isEditFromUs: boolean = false;
	private _allEditsAreFromUs: boolean = true;
	private _diffOperation: Promise<IDocumentDiff | undefined> | undefined;
	private _diffOperationIds: number = 0;

	private readonly _diffInfo = observableValue<IDocumentDiff>(this, nullDocumentDiff);

	readonly changesCount = this._diffInfo.map(diff => diff.changes.length);

	private readonly _editDecorationClear = this._register(new RunOnceScheduler(() => { this._editDecorations = this.doc.deltaDecorations(this._editDecorations, []); }, 500));
	private _editDecorations: string[] = [];


	private readonly _diffTrimWhitespace: IObservable<boolean>;

	readonly originalURI: URI;

	constructor(
		resourceRef: IReference<IResolvedTextEditorModel>,
		private readonly _multiDiffEntryDelegate: { collapse: (transaction: ITransaction | undefined) => void },
		telemetryInfo: IModifiedEntryTelemetryInfo,
		kind: ChatEditKind,
		initialContent: string | undefined,
		@IModelService modelService: IModelService,
		@ITextModelService textModelService: ITextModelService,
		@ILanguageService languageService: ILanguageService,
		@IConfigurationService configService: IConfigurationService,
		@IFilesConfigurationService fileConfigService: IFilesConfigurationService,
		@IChatService chatService: IChatService,
		@IEditorWorkerService private readonly _editorWorkerService: IEditorWorkerService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService,
		@IFileService fileService: IFileService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(
			resourceRef.object.textEditorModel.uri,
			telemetryInfo,
			kind,
			configService,
			fileConfigService,
			chatService,
			fileService,
			instantiationService
		);

		this.docFileEditorModel = this._register(resourceRef).object as IResolvedTextFileEditorModel;
		this.doc = resourceRef.object.textEditorModel;
		this.originalURI = ChatEditingTextModelContentProvider.getFileURI(telemetryInfo.sessionId, this.entryId, this.modifiedURI.path);

		this.initialContent = initialContent ?? this.doc.getValue();
		const docSnapshot = this.docSnapshot = this._register(
			modelService.createModel(
				createTextBufferFactoryFromSnapshot(initialContent ? stringToSnapshot(initialContent) : this.doc.createSnapshot()),
				languageService.createById(this.doc.getLanguageId()),
				this.originalURI,
				false
			)
		);

		// Create a reference to this model to avoid it being disposed from under our nose
		(async () => {
			const reference = await textModelService.createModelReference(docSnapshot.uri);
			if (this._store.isDisposed) {
				reference.dispose();
				return;
			}
			this._register(reference);
		})();


		this._register(this.doc.onDidChangeContent(e => this._mirrorEdits(e)));

		this._register(toDisposable(() => {
			this._clearCurrentEditLineDecoration();
		}));

		this._diffTrimWhitespace = observableConfigValue('diffEditor.ignoreTrimWhitespace', true, configService);
		this._register(autorun(r => {
			this._diffTrimWhitespace.read(r);
			this._updateDiffInfoSeq();
		}));
	}

	private _clearCurrentEditLineDecoration() {
		this._editDecorations = this.doc.deltaDecorations(this._editDecorations, []);
	}

	equalsSnapshot(snapshot: ISnapshotEntry | undefined): boolean {
		return !!snapshot &&
			this.modifiedURI.toString() === snapshot.resource.toString() &&
			this.modifiedModel.getLanguageId() === snapshot.languageId &&
			this.originalModel.getValue() === snapshot.original &&
			this.modifiedModel.getValue() === snapshot.current &&
			this._edit.equals(snapshot.originalToCurrentEdit) &&
			this.state.get() === snapshot.state;
	}

	createSnapshot(requestId: string | undefined, undoStop: string | undefined): ISnapshotEntry {
		return {
			resource: this.modifiedURI,
			languageId: this.modifiedModel.getLanguageId(),
			snapshotUri: ChatEditingSnapshotTextModelContentProvider.getSnapshotFileURI(this._telemetryInfo.sessionId, requestId, undoStop, this.modifiedURI.path),
			original: this.originalModel.getValue(),
			current: this.modifiedModel.getValue(),
			originalToCurrentEdit: this._edit,
			state: this.state.get(),
			telemetryInfo: this._telemetryInfo
		};
	}

	restoreFromSnapshot(snapshot: ISnapshotEntry) {
		this._stateObs.set(snapshot.state, undefined);
		this.docSnapshot.setValue(snapshot.original);
		this._setDocValue(snapshot.current);
		this._edit = snapshot.originalToCurrentEdit;
		this._updateDiffInfoSeq();
	}

	resetToInitialContent() {
		this._setDocValue(this.initialContent);
	}

	override async acceptStreamingEditsEnd(tx: ITransaction) {
		const diff = await this._diffOperation;
		super.acceptStreamingEditsEnd(tx);
		if (diff?.identical) {
			this.accept(tx);
		}
	}

	protected override _resetEditsState(tx: ITransaction): void {
		super._resetEditsState(tx);
		this._clearCurrentEditLineDecoration();
	}

	private _mirrorEdits(event: IModelContentChangedEvent) {
		const edit = OffsetEdits.fromContentChanges(event.changes);

		if (this._isEditFromUs) {
			const e_sum = this._edit;
			const e_ai = edit;
			this._edit = e_sum.compose(e_ai);

		} else {

			//           e_ai
			//   d0 ---------------> s0
			//   |                   |
			//   |                   |
			//   | e_user_r          | e_user
			//   |                   |
			//   |                   |
			//   v       e_ai_r      v
			///  d1 ---------------> s1
			//
			// d0 - document snapshot
			// s0 - document
			// e_ai - ai edits
			// e_user - user edits
			//
			const e_ai = this._edit;
			const e_user = edit;

			const e_user_r = e_user.tryRebase(e_ai.inverse(this.docSnapshot.getValue()), true);

			if (e_user_r === undefined) {
				// user edits overlaps/conflicts with AI edits
				this._edit = e_ai.compose(e_user);
			} else {
				const edits = OffsetEdits.asEditOperations(e_user_r, this.docSnapshot);
				this.docSnapshot.applyEdits(edits);
				this._edit = e_ai.tryRebase(e_user_r);
			}

			this._allEditsAreFromUs = false;
			this._updateDiffInfoSeq();

			const didResetToOriginalContent = this.doc.getValue() === this.initialContent;
			const currentState = this._stateObs.get();
			switch (currentState) {
				case WorkingSetEntryState.Modified:
					if (didResetToOriginalContent) {
						this._stateObs.set(WorkingSetEntryState.Rejected, undefined);
						break;
					}
			}
		}
	}

	override acceptStreamingEditsStart(responseModel: IChatResponseModel, tx: ITransaction) {
		super.acceptStreamingEditsStart(responseModel, tx);

		// push stack element whenever streaming starts
		const request = responseModel.session.getRequests().find(req => req.id === responseModel.requestId);
		const label = request?.message.text ? localize('chatEditing1', "Chat Edit: '{0}'", request.message.text) : localize('chatEditing2', "Chat Edit");
		this._undoRedoService.pushElement(new SingleModelEditStackElement(label, 'chat.edit', this.doc, null));
	}

	async acceptAgentEdits(resource: URI, textEdits: (TextEdit | ICellEditOperation)[], isLastEdits: boolean, responseModel: IChatResponseModel): Promise<void> {

		assertType(textEdits.every(TextEdit.isTextEdit), 'INVALID args, can only handle text edits');
		assert(isEqual(resource, this.modifiedURI), ' INVALID args, can only edit THIS document');

		const ops = textEdits.map(TextEdit.asEditOperation);
		const undoEdits = this._applyEdits(ops);

		const maxLineNumber = undoEdits.reduce((max, op) => Math.max(max, op.range.startLineNumber), 0);

		const newDecorations: IModelDeltaDecoration[] = [
			// decorate pending edit (region)
			{
				options: ChatEditingModifiedDocumentEntry._pendingEditDecorationOptions,
				range: new Range(maxLineNumber + 1, 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
			}
		];

		if (maxLineNumber > 0) {
			// decorate last edit
			newDecorations.push({
				options: ChatEditingModifiedDocumentEntry._lastEditDecorationOptions,
				range: new Range(maxLineNumber, 1, maxLineNumber, Number.MAX_SAFE_INTEGER)
			});
		}

		this._editDecorations = this.doc.deltaDecorations(this._editDecorations, newDecorations);


		transaction((tx) => {
			if (!isLastEdits) {
				this._stateObs.set(WorkingSetEntryState.Modified, tx);
				this._isCurrentlyBeingModifiedByObs.set(responseModel, tx);
				const lineCount = this.doc.getLineCount();
				this._rewriteRatioObs.set(Math.min(1, maxLineNumber / lineCount), tx);

			} else {
				this._resetEditsState(tx);
				this._updateDiffInfoSeq();
				this._rewriteRatioObs.set(1, tx);
				this._editDecorationClear.schedule();
			}
		});
	}

	private async _acceptHunk(change: DetailedLineRangeMapping): Promise<boolean> {
		if (!this._diffInfo.get().changes.includes(change)) {
			// diffInfo should have model version ids and check them (instead of the caller doing that)
			return false;
		}
		const edits: ISingleEditOperation[] = [];
		for (const edit of change.innerChanges ?? []) {
			const newText = this.modifiedModel.getValueInRange(edit.modifiedRange);
			edits.push(EditOperation.replace(edit.originalRange, newText));
		}
		this.docSnapshot.pushEditOperations(null, edits, _ => null);
		await this._updateDiffInfoSeq();
		if (this._diffInfo.get().identical) {
			this._stateObs.set(WorkingSetEntryState.Accepted, undefined);
		}
		return true;
	}

	private async _rejectHunk(change: DetailedLineRangeMapping): Promise<boolean> {
		if (!this._diffInfo.get().changes.includes(change)) {
			return false;
		}
		const edits: ISingleEditOperation[] = [];
		for (const edit of change.innerChanges ?? []) {
			const newText = this.docSnapshot.getValueInRange(edit.originalRange);
			edits.push(EditOperation.replace(edit.modifiedRange, newText));
		}
		this.doc.pushEditOperations(null, edits, _ => null);
		await this._updateDiffInfoSeq();
		if (this._diffInfo.get().identical) {
			this._stateObs.set(WorkingSetEntryState.Rejected, undefined);
		}
		return true;
	}

	private _applyEdits(edits: ISingleEditOperation[]) {
		// make the actual edit
		this._isEditFromUs = true;
		try {
			let result: ISingleEditOperation[] = [];
			this.doc.pushEditOperations(null, edits, (undoEdits) => {
				result = undoEdits;
				return null;
			});
			return result;
		} finally {
			this._isEditFromUs = false;
		}
	}

	private async _updateDiffInfoSeq() {
		const myDiffOperationId = ++this._diffOperationIds;
		await Promise.resolve(this._diffOperation);
		if (this._diffOperationIds === myDiffOperationId) {
			const thisDiffOperation = this._updateDiffInfo();
			this._diffOperation = thisDiffOperation;
			await thisDiffOperation;
		}
	}

	private async _updateDiffInfo(): Promise<IDocumentDiff | undefined> {

		if (this.docSnapshot.isDisposed() || this.doc.isDisposed()) {
			return undefined;
		}

		const docVersionNow = this.doc.getVersionId();
		const snapshotVersionNow = this.docSnapshot.getVersionId();

		const ignoreTrimWhitespace = this._diffTrimWhitespace.get();

		const diff = await this._editorWorkerService.computeDiff(
			this.docSnapshot.uri,
			this.doc.uri,
			{ ignoreTrimWhitespace, computeMoves: false, maxComputationTimeMs: 3000 },
			'advanced'
		);

		if (this.docSnapshot.isDisposed() || this.doc.isDisposed()) {
			return undefined;
		}

		// only update the diff if the documents didn't change in the meantime
		if (this.doc.getVersionId() === docVersionNow && this.docSnapshot.getVersionId() === snapshotVersionNow) {
			const diff2 = diff ?? nullDocumentDiff;
			this._diffInfo.set(diff2, undefined);
			this._edit = OffsetEdits.fromLineRangeMapping(this.docSnapshot, this.doc, diff2.changes);
			return diff2;
		}
		return undefined;
	}

	protected override async _doAccept(tx: ITransaction | undefined): Promise<void> {
		this.docSnapshot.setValue(this.doc.createSnapshot());
		this._diffInfo.set(nullDocumentDiff, tx);
		this._edit = OffsetEdit.empty;
		await this._collapse(tx);
	}

	protected override async _doReject(tx: ITransaction | undefined): Promise<void> {
		if (this.createdInRequestId === this._telemetryInfo.requestId) {
			await this.docFileEditorModel.revert({ soft: true });
			await this._fileService.del(this.modifiedURI);
			this._onDidDelete.fire();
		} else {
			this._setDocValue(this.docSnapshot.getValue());
			if (this._allEditsAreFromUs) {
				// save the file after discarding so that the dirty indicator goes away
				// and so that an intermediate saved state gets reverted
				await this.docFileEditorModel.save({ reason: SaveReason.EXPLICIT, skipSaveParticipants: true });
			}
			await this._collapse(tx);
		}
	}

	private _setDocValue(value: string): void {
		if (this.doc.getValue() !== value) {

			this.doc.pushStackElement();
			const edit = EditOperation.replace(this.doc.getFullModelRange(), value);

			this._applyEdits([edit]);
			this._updateDiffInfoSeq();
			this.doc.pushStackElement();
		}
	}

	private async _collapse(transaction: ITransaction | undefined): Promise<void> {
		this._multiDiffEntryDelegate.collapse(transaction);
	}

	protected _createEditorIntegration(editor: IEditorPane): IModifiedFileEntryEditorIntegration {
		const codeEditor = getCodeEditor(editor.getControl());
		assertType(codeEditor);

		const diffInfo = this._diffInfo.map(value => {
			return {
				...value,
				originalModel: this.originalModel,
				modifiedModel: this.modifiedModel,
				keep: changes => this._acceptHunk(changes),
				undo: changes => this._rejectHunk(changes)
			} satisfies IDocumentDiff2;
		});

		return this._instantiationService.createInstance(ChatEditingCodeEditorIntegration, this, codeEditor, diffInfo);
	}
}
