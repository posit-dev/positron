/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeSession, IRuntimeSessionService, IRuntimeSessionWillStartEvent } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

export class TestRuntimeSessionService extends Disposable implements Partial<IRuntimeSessionService> {
	private readonly _willStartEmitter = this._register(new Emitter<IRuntimeSessionWillStartEvent>());

	readonly activeSessions = new Array<ILanguageRuntimeSession>();

	readonly onWillStartSession = this._willStartEmitter.event;

	// Test helpers.

	startSession(session: ILanguageRuntimeSession): void {
		this.activeSessions.push(session);
		this._willStartEmitter.fire({ session, isNew: true });
	}
}

