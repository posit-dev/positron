/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Delayer } from '../../../../base/common/async.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IMissingPackagesService } from '../common/missingPackagesService.js';

/** Debounce window before precomputing, so we don't recompute on every keystroke. */
const PRECOMPUTE_DELAY_MS = 750;

/**
 * Keeps the missing-packages cache warm for the active editor by computing it in
 * the background on editor open/focus and on debounced content changes. This is
 * what lets the preflight check (scenario 1) read a synchronous cached result
 * without ever blocking the run gesture.
 */
export class MissingPackagesPrecomputeContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronMissingPackagesPrecompute';

	private readonly _delayer = this._register(new Delayer<void>(PRECOMPUTE_DELAY_MS));
	private readonly _contentListener = this._register(new MutableDisposable());

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IMissingPackagesService private readonly _missingPackagesService: IMissingPackagesService,
	) {
		super();

		this._register(this._editorService.onDidActiveEditorChange(() => this._onActiveEditorChanged()));
		this._onActiveEditorChanged();
	}

	private _onActiveEditorChanged(): void {
		const resource = this._editorService.activeEditor?.resource;

		// Re-arm the content listener for the active editor's model so edits
		// schedule a recompute (the cache keys on content hash, so an edit
		// otherwise leaves a stale-keyed entry until something else asks).
		this._contentListener.clear();
		const editor = this._codeEditorService.getActiveCodeEditor();
		const model = editor?.getModel();
		if (model) {
			this._contentListener.value = model.onDidChangeContent(() => this._schedule(resource));
		}

		this._schedule(resource);
	}

	private _schedule(resource: URI | undefined): void {
		if (!resource) {
			return;
		}
		this._delayer.trigger(async () => {
			try {
				await this._missingPackagesService.ensure(resource);
			} catch {
				// Precompute is best-effort; failures surface when a consumer asks.
			}
		});
	}
}
