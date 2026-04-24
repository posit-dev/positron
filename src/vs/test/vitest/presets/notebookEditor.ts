/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ICodeEditorService } from '../../../editor/browser/services/codeEditorService.js';
import { IEditorWorkerService } from '../../../editor/common/services/editorWorker.js';
import { ILanguageFeatureDebounceService, LanguageFeatureDebounceService } from '../../../editor/common/services/languageFeatureDebounce.js';
import { ILanguageFeaturesService } from '../../../editor/common/services/languageFeatures.js';
import { LanguageFeaturesService } from '../../../editor/common/services/languageFeaturesService.js';
import { ITreeSitterLibraryService } from '../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { TestCodeEditorService } from '../../../editor/test/browser/editorTestServices.js';
import { TestEditorWorkerService } from '../../../editor/test/common/services/testEditorWorkerService.js';
import { TestTreeSitterLibraryService } from '../../../editor/test/common/services/testTreeSitterLibraryService.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IPositronWebviewPreloadService } from '../../../workbench/services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';

/**
 * Notebook-editor services layer: the editor/language/tree-sitter/webview-preload
 * stubs required to attach TestCodeEditor instances to notebook cells. Applied
 * additively on top of the Workbench base.
 *
 * This is the preset form of the legacy `positronNotebookInstantiationService`
 * helper -- prefer using `.withNotebookEditorServices()` on the builder over
 * calling the helper inside `beforeEach`.
 */
export function stubNotebookEditorServices(
	svc: TestInstantiationService,
	disposables: Pick<DisposableStore, 'add'>,
): void {
	svc.stub(ICodeEditorService, disposables.add(svc.createInstance(TestCodeEditorService)));
	svc.stub(IEditorWorkerService, new TestEditorWorkerService());
	svc.stub(ILanguageFeatureDebounceService, svc.createInstance(LanguageFeatureDebounceService));
	svc.stub(ILanguageFeaturesService, new LanguageFeaturesService());
	svc.stub(ITreeSitterLibraryService, new TestTreeSitterLibraryService());

	// Override the real webview preload service with a lightweight mock to
	// avoid creating real webviews (which create undisposed disposables in
	// unit tests). Returns a display-type result for rawHtml outputs and
	// undefined otherwise.
	// eslint-disable-next-line local/code-no-dangerous-type-assertions
	svc.stub(IPositronWebviewPreloadService, {
		initialize: () => { },
		attachNotebookInstance: () => { },
		addNotebookOutput: (opts: { outputId: string; rawHtml?: string }) => {
			if (opts.rawHtml) {
				return {
					preloadMessageType: 'display' as const,
					webview: Promise.resolve({
						id: opts.outputId,
						sessionId: opts.outputId,
						dispose() { },
						onDidRender: Event.None,
					}),
				};
			}
			return undefined;
		},
	} as Partial<IPositronWebviewPreloadService> as IPositronWebviewPreloadService);
}
