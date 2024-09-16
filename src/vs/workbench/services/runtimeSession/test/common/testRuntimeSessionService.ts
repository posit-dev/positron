/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeClientCreatedEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeGlobalEvent, ILanguageRuntimeSession, IRuntimeSessionService, IRuntimeSessionWillStartEvent } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

export class TestRuntimeSessionService extends Disposable implements Partial<IRuntimeSessionService> {
	private readonly _willStartEmitter = this._register(new Emitter<IRuntimeSessionWillStartEvent>());
	private readonly _didStartRuntime = this._register(new Emitter<ILanguageRuntimeSession>());
	private readonly _didReceiveRuntimeEvent = this._register(new Emitter<ILanguageRuntimeGlobalEvent>());
	private readonly _didCreateClientInstance = this._register(new Emitter<ILanguageRuntimeClientCreatedEvent>());

	readonly activeSessions = new Array<ILanguageRuntimeSession>();

	readonly onWillStartSession = this._willStartEmitter.event;

	readonly onDidStartRuntime = this._didStartRuntime.event;

	readonly onDidReceiveRuntimeEvent = this._didReceiveRuntimeEvent.event;

	readonly onDidCreateClientInstance = this._didCreateClientInstance.event;

	// Test helpers.

	startSession(session: ILanguageRuntimeSession): void {
		this.activeSessions.push(session);
		this._register(session.onDidCreateClientInstance(e => this._didCreateClientInstance.fire(e)));
		this._willStartEmitter.fire({ session, isNew: true });
		this._didStartRuntime.fire(session);
	}
}

