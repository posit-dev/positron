/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionDisplayInfo } from './runtimeSessionService.js';

/**
 * A lightweight object containing display-relevant properties from a session.
 * Contains only the properties needed to display session information in the UI.
 */
export class RuntimeSessionDisplayInfo implements IRuntimeSessionDisplayInfo {
	public readonly sessionName: string;
	public readonly sessionState: RuntimeState;
	public readonly sessionMode: LanguageRuntimeSessionMode;
	public readonly notebookUri: URI | undefined;
	public readonly runtimeId: string;
	public readonly languageName: string;
	public readonly languageId: string;
	public readonly base64EncodedIconSvg: string | undefined;

	constructor(session: ILanguageRuntimeSession) {
		this.sessionName = session.dynState.sessionName;
		this.sessionState = session.getRuntimeState();
		this.sessionMode = session.metadata.sessionMode;
		this.notebookUri = session.metadata.notebookUri;
		this.runtimeId = session.runtimeMetadata.runtimeId;
		this.languageName = session.runtimeMetadata.languageName;
		this.languageId = session.runtimeMetadata.languageId;
		this.base64EncodedIconSvg = session.runtimeMetadata.base64EncodedIconSvg;
	}
}
