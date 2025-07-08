/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IChatRequestRuntimeSessionEntry } from '../../common/chatModel.js';
import { IChatWidgetService } from '../chat.js';
import { IRuntimeSessionService, ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';

export class ChatRuntimeSessionContextContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'chat.runtimeSessionContext';

	constructor(
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
	) {
		super();

		this._register(this.runtimeSessionService.onDidChangeForegroundSession(() => this.updateRuntimeContext()));
		this._register(this.chatWidgetService.onDidAddWidget(async (widget) => {
			await this.updateRuntimeContext();
		}));
	}

	private async updateRuntimeContext(): Promise<void> {
		const session = this.runtimeSessionService.foregroundSession;
		const widgets = [...this.chatWidgetService.getAllWidgets()];
		for (const widget of widgets) {
			if (!widget.input.runtimeContext) {
				continue;
			}
			widget.input.runtimeContext.setValue(session);
		}
	}
}

export class ChatRuntimeSessionContext extends Disposable {
	get id() {
		return 'vscode.implicit.runtimeSession';
	}

	get name(): string {
		if (this.value) {
			return this.value.getLabel();
		} else {
			return 'runtimeSession';
		}
	}

	get modelDescription(): string {
		if (this.value) {
			return `User's active runtime session`;
		}
		return '';
	}

	private _onDidChangeValue = this._register(new Emitter<void>());
	readonly onDidChangeValue = this._onDidChangeValue.event;

	private _value: ILanguageRuntimeSession | undefined;
	get value() {
		return this._value;
	}

	private _enabled = true;
	get enabled() {
		return this._enabled;
	}

	set enabled(value: boolean) {
		this._enabled = value;
		this._onDidChangeValue.fire();
	}

	constructor() {
		super();
	}

	setValue(value: ILanguageRuntimeSession | undefined): void {
		this._value = value;
		this._onDidChangeValue.fire();
	}

	public async toBaseEntries(): Promise<IChatRequestRuntimeSessionEntry[]> {
		if (!this.value) {
			return [];
		}
		return [
			{
				kind: 'runtimeSession',
				id: this.id,
				name: this.name,
				value: {
					activeSession: this.value,
					// TODO: Get variables
					variables: {}
				}
			}
		];
	}
}
