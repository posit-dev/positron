/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isObject } from '../../../../../base/common/types.js';

/**
 * Merge a tag list into an nbformat cell's nested metadata object.
 *
 * nbformat tags live under the nested `metadata.metadata.tags` -- the only
 * location the ipynb serializer writes to the file, so tags round-trip across
 * save/reload. A cell metadata edit (PartialMetadata) is a shallow top-level
 * merge, so the existing nested object is spread to preserve sibling keys
 * (`vscode.languageId`, `collapsed`, etc.) rather than replacing it. The `tags`
 * key is dropped entirely when the list is empty, per nbformat convention.
 *
 * `existingNested` is untrusted file data; it is only spread when it is a plain
 * object, otherwise spreading a scalar/array would inject numeric keys into the
 * persisted metadata.
 */
export function applyTagsToNestedMetadata(existingNested: unknown, tags: string[]): Record<string, unknown> {
	const nestedMetadata: Record<string, unknown> = isObject(existingNested)
		? { ...(existingNested as Record<string, unknown>) }
		: {};
	if (tags.length > 0) {
		nestedMetadata.tags = tags;
	} else {
		delete nestedMetadata.tags;
	}
	return nestedMetadata;
}
