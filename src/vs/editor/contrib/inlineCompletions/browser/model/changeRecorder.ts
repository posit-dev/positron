/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { autorunWithStore } from '../../../../../base/common/observable.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor } from '../../../../browser/editorBrowser.js';
import { CodeEditorWidget } from '../../../../browser/widget/codeEditor/codeEditorWidget.js';
import { IDocumentEventDataSetChangeReason, IRecordableEditorLogEntry, StructuredLogger } from '../structuredLogger.js';

export interface ITextModelChangeRecorderMetadata {
	source?: string;
	extensionId?: string;
	nes?: boolean;
	type?: 'word' | 'line';
}

export class TextModelChangeRecorder extends Disposable {
	private static _nextMetadataId = 0;
	private static _metaDataMap = new Map<number, ITextModelChangeRecorderMetadata>();

	/**
	 * Adds metadata to any edit operation made in the callback (sync).
	*/
	public static editWithMetadata<T>(metadata: ITextModelChangeRecorderMetadata, cb: () => T): T {
		const id = this._nextMetadataId++;
		this._metaDataMap.set(id, metadata);
		try {
			const result = cb();
			return result;
		} finally {
			this._metaDataMap.delete(id);
		}
	}

	private static _getCurrentMetadata(): ITextModelChangeRecorderMetadata {
		const result: ITextModelChangeRecorderMetadata = {};
		for (const metadata of this._metaDataMap.values()) {
			Object.assign(result, metadata);
		}
		return result;
	}

	private readonly _structuredLogger = this._register(this._instantiationService.createInstance(StructuredLogger.cast<IRecordableEditorLogEntry & IDocumentEventDataSetChangeReason>(),
		'editor.inlineSuggest.logChangeReason.commandId'
	));

	constructor(
		private readonly _editor: ICodeEditor,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this._register(autorunWithStore((reader, store) => {
			if (!(this._editor instanceof CodeEditorWidget)) { return; }
			if (!this._structuredLogger.isEnabled.read(reader)) { return; }

			const sources: string[] = [];

			store.add(this._editor.onBeforeExecuteEdit(({ source }) => {
				if (source) {
					sources.push(source);
				}
			}));

			store.add(this._editor.onDidChangeModelContent(e => {
				const tm = this._editor.getModel();
				if (!tm) { return; }
				const metadata = TextModelChangeRecorder._getCurrentMetadata();
				if (sources.length === 0 && metadata.source) {
					sources.push(metadata.source);
				}

				for (const source of sources) {
					const data: IRecordableEditorLogEntry & IDocumentEventDataSetChangeReason = {
						...metadata,
						sourceId: 'TextModel.setChangeReason',
						source: source,
						time: Date.now(),
						modelUri: tm.uri.toString(),
						modelVersion: tm.getVersionId(),
					};
					setTimeout(() => {
						// To ensure that this reaches the extension host after the content change event.
						// (Without the setTimeout, I observed this command being called before the content change event arrived)
						this._structuredLogger.log(data);
					}, 0);
				}
				sources.length = 0;
			}));
		}));
	}
}
