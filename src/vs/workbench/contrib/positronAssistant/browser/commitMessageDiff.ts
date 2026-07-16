/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { generateUnifiedDiff } from '../../chat/browser/chatRepoInfo.js';
import { ISCMResource, ISCMResourceGroup } from '../../scm/common/scm.js';

type ChangeType = 'added' | 'modified' | 'deleted';

/**
 * System prompt for commit message generation.
 */
export const COMMIT_MESSAGE_SYSTEM_PROMPT = `You will be given a set of repository changes and diffs. Summarise the changes in a single line and output only a short git commit message. If you must output a git commit message body, keep it very short and focused.`;

/** The id of git's staged-changes resource group. */
const GIT_STAGED_GROUP_ID = 'index';

/**
 * Character budget per file. Keeps any single large file from dominating
 * the prompt.
 */
const MAX_FILE_CONTEXT_CHARS = 8 * 1024;

/**
 * Maximum number of files summarized. Bounds the whole prompt so a large
 * change set cannot produce a prompt large enough to overload the model.
 */
const MAX_FILES = 100;

/** Note appended to the context when changes are omitted to stay within budget. */
const OMISSION_NOTE = '[Some changes were omitted to keep this summary concise.]';

/**
 * Build the user message describing a repository's changes for the model.
 * Prefers the staged group when it has changes, otherwise summarizes every
 * group. Returns an empty string when there is nothing to describe.
 */
export async function buildCommitMessageContext(
	fileService: IFileService,
	rootUri: URI,
	groups: readonly ISCMResourceGroup[],
): Promise<string> {
	const stagedGroup = groups.find(group => group.id === GIT_STAGED_GROUP_ID && group.resources.length > 0);
	const relevantGroups = stagedGroup ? [stagedGroup] : groups;

	const resources = relevantGroups.flatMap(group =>
		group.resources.map(resource => ({ resource, groupId: group.id })));

	const summaries = await Promise.all(resources.slice(0, MAX_FILES).map(async ({ resource, groupId }) => {
		const relPath = relativePath(rootUri, resource.sourceUri) ?? resource.sourceUri.path;
		const changeType = determineChangeType(resource, groupId);
		const diff = await generateUnifiedDiff(
			fileService,
			relPath,
			resource.multiDiffEditorOriginalUri,
			resource.multiDiffEditorModifiedUri ?? resource.sourceUri,
			changeType,
		);
		return diff ?? `${changeTypeLabel(changeType)}: ${relPath}`;
	}));

	return assembleContext(summaries.filter(summary => summary.length > 0), resources.length > MAX_FILES);
}

/**
 * Truncate each summary to the per-file budget and join into a single prompt.
 * Appends {@link OMISSION_NOTE} when any file was truncated or dropped.
 */
function assembleContext(summaries: readonly string[], filesAlreadyDropped: boolean): string {
	let truncated = filesAlreadyDropped;

	const parts = summaries.map(summary => {
		if (summary.length > MAX_FILE_CONTEXT_CHARS) {
			truncated = true;
			return summary.slice(0, MAX_FILE_CONTEXT_CHARS);
		}
		return summary;
	});

	if (parts.length === 0) {
		return '';
	}
	return truncated ? `${parts.join('\n')}\n${OMISSION_NOTE}` : parts.join('\n');
}

/**
 * Infer a change type from an SCM resource's group and diff URIs.
 */
function determineChangeType(resource: ISCMResource, groupId: string): ChangeType {
	if (groupId.toLowerCase().includes('untracked')) {
		return 'added';
	}
	if (resource.decorations.strikeThrough || (resource.multiDiffEditorOriginalUri && !resource.multiDiffEditorModifiedUri)) {
		return 'deleted';
	}
	if (!resource.multiDiffEditorOriginalUri) {
		return 'added';
	}
	return 'modified';
}

/** A human-readable label for a change type. */
function changeTypeLabel(changeType: ChangeType): string {
	switch (changeType) {
		case 'added': return 'Added';
		case 'deleted': return 'Deleted';
		case 'modified': return 'Modified';
	}
}
