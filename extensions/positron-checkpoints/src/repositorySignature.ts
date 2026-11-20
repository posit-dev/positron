/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** The parts of the git extension's repository state that the signature reads. */
export interface SignatureState {
	readonly HEAD: { readonly name?: string; readonly commit?: string; readonly ahead?: number; readonly behind?: number; readonly upstream?: { readonly remote: string; readonly name: string; readonly commit?: string } } | undefined;
	readonly mergeChanges: readonly SignatureChange[];
	readonly indexChanges: readonly SignatureChange[];
	readonly workingTreeChanges: readonly SignatureChange[];
	readonly untrackedChanges: readonly SignatureChange[];
}
interface SignatureChange { readonly uri: { toString(): string }; readonly status: number }

/**
 * A text that is the same for two states of a repository exactly when the git extension reports
 * the same branch, the same commit, the same upstream and distance from it, and the same changed
 * files with the same status in each of its lists. An edit to a file that is already listed
 * leaves it unchanged; the host's file watcher reports those.
 */
export function repositorySignature(state: SignatureState): string {
	const head = state.HEAD;
	const changes = (list: readonly SignatureChange[]) => list.map(change => `${change.status}:${change.uri.toString()}`).sort();
	return JSON.stringify([
		head?.name, head?.commit, head?.ahead, head?.behind, head?.upstream?.remote, head?.upstream?.name, head?.upstream?.commit,
		changes(state.mergeChanges), changes(state.indexChanges), changes(state.workingTreeChanges), changes(state.untrackedChanges),
	]);
}
