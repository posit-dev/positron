/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../../base/common/event.js';
import { derived, IObservable } from '../../../../../../base/common/observable.js';
import { localize } from '../../../../../../nls.js';
import { ICodeEditor } from '../../../../../browser/editorBrowser.js';
import { observableCodeEditor } from '../../../../../browser/observableCodeEditor.js';
import { LineRange } from '../../../../../common/core/lineRange.js';
import { StringText, TextEdit } from '../../../../../common/core/textEdit.js';
import { Command } from '../../../../../common/languages.js';
import { InlineCompletionsModel } from '../../model/inlineCompletionsModel.js';
import { InlineCompletionWithUpdatedRange } from '../../model/inlineCompletionsSource.js';
import { IInlineEditHost, IInlineEditModel, InlineEditTabAction } from './inlineEditsViewInterface.js';
import { InlineEditWithChanges } from './inlineEditWithChanges.js';

export class InlineEditModel implements IInlineEditModel {

	readonly action: Command | undefined;
	readonly displayName: string;
	readonly extensionCommands: Command[];

	readonly showCollapsed: IObservable<boolean>;

	constructor(
		private readonly _model: InlineCompletionsModel,
		readonly inlineEdit: InlineEditWithChanges,
		readonly tabAction: IObservable<InlineEditTabAction>,
	) {
		this.action = this.inlineEdit.inlineCompletion.action;
		this.displayName = this.inlineEdit.inlineCompletion.source.provider.displayName ?? localize('inlineEdit', "Inline Edit");
		this.extensionCommands = this.inlineEdit.inlineCompletion.source.inlineCompletions.commands ?? [];

		this.showCollapsed = this._model.showCollapsed;
	}

	accept() {
		this._model.accept();
	}

	jump() {
		this._model.jump();
	}

	abort(reason: string) {
		console.error(reason); // TODO: add logs/telemetry
		this._model.stop();
	}

	handleInlineEditShown() {
		this._model.handleInlineEditShown(this.inlineEdit.inlineCompletion);
	}
}

export class InlineEditHost implements IInlineEditHost {
	readonly onDidAccept: Event<void>;
	readonly inAcceptFlow: IObservable<boolean>;
	readonly inPartialAcceptFlow: IObservable<boolean>;

	constructor(
		private readonly _model: InlineCompletionsModel,
	) {
		this.onDidAccept = this._model.onDidAccept;
		this.inAcceptFlow = this._model.inAcceptFlow;
		this.inPartialAcceptFlow = this._model.inPartialAcceptFlow;
	}
}

export class GhostTextIndicator {

	readonly model: InlineEditModel;

	constructor(
		editor: ICodeEditor,
		model: InlineCompletionsModel,
		readonly lineRange: LineRange,
		inlineCompletion: InlineCompletionWithUpdatedRange,
	) {
		const editorObs = observableCodeEditor(editor);
		const tabAction = derived<InlineEditTabAction>(this, reader => {
			if (editorObs.isFocused.read(reader)) {
				if (model.inlineCompletionState.read(reader)?.inlineCompletion?.sourceInlineCompletion.showInlineEditMenu) {
					return InlineEditTabAction.Accept;
				}
			}
			return InlineEditTabAction.Inactive;
		});

		this.model = new InlineEditModel(
			model,
			new InlineEditWithChanges(
				new StringText(''),
				new TextEdit([]),
				model.primaryPosition.get(),
				inlineCompletion.source.inlineCompletions.commands ?? [],
				inlineCompletion.inlineCompletion
			),
			tabAction,
		);
	}
}
