/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ICheckpointsService } from '../../../services/positronCheckpoints/common/checkpointsService.js';

/** The scheme of the read-only texts that the diff editor shows for the checkpoint side. */
export const CHECKPOINTS_SCHEME = 'positron-checkpoints';

/** The query prefix of a resource that holds a message instead of the content of a blob. */
const MESSAGE_QUERY_PREFIX = 'message=';

/**
 * The resource of a stored version of a file. The path is the display path of the file and the
 * query is the id of the stored content. An empty id is an empty text.
 */
export function blobResource(path: string, oid: string): URI {
	return URI.from({ scheme: CHECKPOINTS_SCHEME, path: `/${path}`, query: oid });
}

/** The resource of a read-only text that says why a comparison is not shown. */
export function messageResource(path: string, message: string): URI {
	return URI.from({ scheme: CHECKPOINTS_SCHEME, path: `/${path}.txt`, query: `${MESSAGE_QUERY_PREFIX}${encodeURIComponent(message)}` });
}

/**
 * Provides the text of `positron-checkpoints` resources: the stored versions of files that the
 * engine reads, and messages. Registered as a workbench contribution.
 */
export class CheckpointsContentProvider extends Disposable implements IWorkbenchContribution, ITextModelContentProvider {
	static readonly ID = 'workbench.contrib.positronCheckpointsContentProvider';

	constructor(
		@ICheckpointsService private readonly _checkpointsService: ICheckpointsService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IModelService private readonly _modelService: IModelService,
		@ITextModelService textModelService: ITextModelService,
	) {
		super();
		this._register(textModelService.registerTextModelContentProvider(CHECKPOINTS_SCHEME, this));
	}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const existing = this._modelService.getModel(resource);
		if (existing) {
			return existing;
		}

		const text = await this._readText(resource);
		if (text === undefined) {
			return null;
		}
		return this._modelService.createModel(text, this._languageService.createByFilepathOrFirstLine(resource), resource);
	}

	/** The text of a resource, or undefined when no engine is registered or it cannot read the content. */
	private async _readText(resource: URI): Promise<string | undefined> {
		if (resource.query.startsWith(MESSAGE_QUERY_PREFIX)) {
			return decodeURIComponent(resource.query.slice(MESSAGE_QUERY_PREFIX.length));
		}
		if (resource.query === '') {
			return '';
		}
		const engine = this._checkpointsService.engine;
		if (!engine) {
			return undefined;
		}
		try {
			return (await engine.readBlob(resource.query)).toString();
		} catch {
			return undefined;
		}
	}
}
