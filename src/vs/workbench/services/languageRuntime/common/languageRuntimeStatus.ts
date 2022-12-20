/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntime, LanguageRuntimeStartupBehavior, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * Tracks the status and startup behavior of a language runtime.
 */
export class LanguageRuntimeStatus {
	public state: RuntimeState;
	constructor(
		public readonly runtime: ILanguageRuntime,
		public readonly startupBehavior: LanguageRuntimeStartupBehavior) {
		this.state = runtime.getRuntimeState();
	}

	public setState(state: RuntimeState): void {
		this.state = state;
	}
}
