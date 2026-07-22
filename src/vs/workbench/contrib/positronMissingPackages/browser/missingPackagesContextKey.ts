/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { QUARTO_LANGUAGE_IDS } from '../../positronQuarto/common/positronQuartoConfig.js';

/**
 * True when the active editor's content can be checked for missing packages:
 * a Quarto document (multi-language, split per chunk downstream), or a language
 * whose console session implements `listMissingPackages`. Language-agnostic:
 * any runtime that implements the capability qualifies, with no language names.
 */
export const MISSING_PACKAGES_SUPPORTED_KEY = new RawContextKey<boolean>('positronActiveEditorSupportsMissingPackages', false);

/**
 * Pure predicate behind {@link MISSING_PACKAGES_SUPPORTED_KEY}, split out so it
 * can be unit-tested without the workbench.
 *
 * @param languageId The active text editor's language id, or undefined.
 * @param session The console session for `languageId`, or undefined.
 */
export function activeEditorSupportsMissingPackages(languageId: string | undefined, session: ILanguageRuntimeSession | undefined): boolean {
	if (!languageId) {
		return false;
	}
	if (QUARTO_LANGUAGE_IDS.includes(languageId)) {
		return true;
	}
	return !!session?.listMissingPackages;
}

/**
 * Maintains {@link MISSING_PACKAGES_SUPPORTED_KEY} in response to active-editor
 * and runtime-session changes.
 */
export class MissingPackagesContextKeyContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronMissingPackagesContextKey';

	private readonly _supported: IContextKey<boolean>;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IEditorService private readonly _editorService: IEditorService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
	) {
		super();
		this._supported = MISSING_PACKAGES_SUPPORTED_KEY.bindTo(contextKeyService);
		this._register(this._editorService.onDidActiveEditorChange(() => this._update()));
		this._register(this._runtimeSessionService.onDidStartRuntime(() => this._update()));
		this._register(this._runtimeSessionService.onDidChangeForegroundSession(() => this._update()));
		this._update();
	}

	private _update(): void {
		const languageId = this._editorService.activeTextEditorLanguageId;
		const session = languageId ? this._runtimeSessionService.getConsoleSessionForLanguage(languageId) : undefined;
		this._supported.set(activeEditorSupportsMissingPackages(languageId, session));
	}
}
