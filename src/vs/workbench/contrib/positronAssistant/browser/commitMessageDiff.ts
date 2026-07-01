/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { generateUnifiedDiff } from '../../chat/browser/chatRepoInfo.js';
import { ISCMResource, ISCMResourceGroup } from '../../scm/common/scm.js';

type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

/**
 * System prompt for commit message generation.
 */
export const COMMIT_MESSAGE_SYSTEM_PROMPT = `You will be given a set of repository changes and diffs. Summarise the changes in a single line and output only a short git commit message. If you must output a git commit message body, keep it very short and focused.`;

/** The id of git's staged-changes resource group. */
const GIT_STAGED_GROUP_ID = 'index';

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

	const summaries = await Promise.all(relevantGroups.flatMap(group =>
		group.resources.map(async resource => {
			const relPath = relativePath(rootUri, resource.sourceUri) ?? resource.sourceUri.path;
			const changeType = determineChangeType(resource, group.id);
			const diff = await generateUnifiedDiff(
				fileService,
				relPath,
				resource.multiDiffEditorOriginalUri,
				resource.sourceUri,
				changeType,
			);
			return diff ?? `${changeTypeLabel(changeType)}: ${relPath}`;
		})
	));

	return summaries.filter(summary => summary.length > 0).join('\n');
}

/** Infer a change type from an SCM resource's decorations, context value, and group. */
function determineChangeType(resource: ISCMResource, groupId: string): ChangeType {
	const contextValue = resource.contextValue?.toLowerCase() ?? '';
	const groupIdLower = groupId.toLowerCase();

	if (contextValue.includes('untracked') || contextValue.includes('add')) {
		return 'added';
	}
	if (contextValue.includes('delete')) {
		return 'deleted';
	}
	if (contextValue.includes('rename')) {
		return 'renamed';
	}
	if (groupIdLower.includes('untracked')) {
		return 'added';
	}
	if (resource.decorations.strikeThrough) {
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
		case 'renamed': return 'Renamed';
		case 'modified': return 'Modified';
	}
}
