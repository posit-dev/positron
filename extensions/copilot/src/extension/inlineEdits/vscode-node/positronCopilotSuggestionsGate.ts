/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { workspace } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Emitter } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IObservable, observableFromEvent } from '../../../util/vs/base/common/observable';

/**
 * Tracks whether Copilot inline suggestions (completions and Next Edit
 * Suggestions) may be registered: true only when Positron's AI main switch
 * (ai.enabled) is on and the provider catalog enables the 'copilot' provider.
 *
 * ai.enabled is also checked at extension activation, but that only covers
 * startup; reading it live here also handles runtime toggles. The catalog's
 * copilot enablement is read asynchronously and seeded to false, so a Copilot
 * provider disabled in providers.json can never register or serve a suggestion
 * during the in-flight first read. The cost is a brief startup delay before
 * Copilot suggestions appear.
 */
export class CopilotSuggestionsGate extends Disposable {

	readonly allowed: IObservable<boolean>;

	constructor(logService: ILogService) {
		super();

		const onDidChange = this._register(new Emitter<void>());
		let copilotProviderEnabled = false;
		positron.ai.isProviderEnabled('copilot').then(
			enabled => {
				copilotProviderEnabled = enabled;
				onDidChange.fire();
			},
			err => {
				// Fail closed: if the initial read fails we cannot confirm the
				// provider is enabled, so leave Copilot suggestions off. A later
				// enablement change corrects it via the listener below.
				logService.error(err, 'Failed to read Copilot provider enablement; leaving Copilot suggestions disabled');
			}
		);
		this._register(positron.ai.onDidChangeProviderEnablement(e => {
			if (e.id === 'copilot') {
				copilotProviderEnabled = e.enabled;
				onDidChange.fire();
			}
		}));
		this._register(workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('ai.enabled')) {
				onDidChange.fire();
			}
		}));
		this.allowed = observableFromEvent(
			this,
			onDidChange.event,
			() => workspace.getConfiguration().get<boolean>('ai.enabled') !== false && copilotProviderEnabled
		);
	}
}
