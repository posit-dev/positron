/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LANGUAGE_SELECTOR } from '../constants.js';
import { IPromptsService } from '../service/types.js';
import { assert } from '../../../../../../base/common/assert.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { assertDefined } from '../../../../../../base/common/types.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { CancellationError } from '../../../../../../base/common/errors.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Registry } from '../../../../../../platform/registry/common/platform.js';
import { FolderReference, NotPromptFile } from '../../promptFileReferenceErrors.js';
import { LifecyclePhase } from '../../../../../services/lifecycle/common/lifecycle.js';
import { ILink, ILinksList, LinkProvider } from '../../../../../../editor/common/languages.js';
import { IWorkbenchContributionsRegistry, Extensions } from '../../../../../common/contributions.js';
import { ILanguageFeaturesService } from '../../../../../../editor/common/services/languageFeatures.js';

/**
 * Provides link references for prompt files.
 */
export class PromptLinkProvider extends Disposable implements LinkProvider {
	constructor(
		@IPromptsService private readonly promptsService: IPromptsService,
		@ILanguageFeaturesService private readonly languageService: ILanguageFeaturesService,
	) {
		super();

		this._register(this.languageService.linkProvider.register(LANGUAGE_SELECTOR, this));
	}

	/**
	 * Provide list of links for the provided text model.
	 */
	public async provideLinks(
		model: ITextModel,
		token: CancellationToken,
	): Promise<ILinksList> {
		assert(
			!token.isCancellationRequested,
			new CancellationError(),
		);

		const parser = this.promptsService.getSyntaxParserFor(model);
		assert(
			!parser.disposed,
			'Prompt parser must not be disposed.',
		);

		// start the parser in case it was not started yet,
		// and wait for it to settle to a final result
		const { references } = await parser
			.start()
			.settled();

		// validate that the cancellation was not yet requested
		assert(
			!token.isCancellationRequested,
			new CancellationError(),
		);

		// filter out references that are not valid links
		const links: ILink[] = references
			.filter((reference) => {
				const { errorCondition, linkRange } = reference;
				if (!errorCondition && linkRange) {
					return true;
				}

				// don't provide links for folder references
				if (errorCondition instanceof FolderReference) {
					return false;
				}

				return errorCondition instanceof NotPromptFile;
			})
			.map((reference) => {
				const { uri, linkRange } = reference;

				// must always be true because of the filter above
				assertDefined(
					linkRange,
					'Link range must be defined.',
				);

				return {
					range: linkRange,
					url: uri,
				};
			});

		return {
			links,
		};
	}
}

// register the provider as a workbench contribution
Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench)
	.registerWorkbenchContribution(PromptLinkProvider, LifecyclePhase.Eventually);
