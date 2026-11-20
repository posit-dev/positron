/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The part of the built-in git extension's API (`extensions/git/src/api/git.d.ts`, version 1)
// that this extension uses, with the same names and shapes.

import { Event, Uri } from 'vscode';

export interface Git {
	readonly path: string;
}

export interface UpstreamRef {
	readonly remote: string;
	readonly name: string;
	readonly commit?: string;
}

export interface Branch {
	readonly name?: string;
	readonly upstream?: UpstreamRef;
}

export interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly onDidChange: Event<void>;
}

export interface FetchOptions {
	remote?: string;
	ref?: string;
	all?: boolean;
	prune?: boolean;
	depth?: number;
}

export interface Repository {
	readonly rootUri: Uri;
	readonly state: RepositoryState;
	getConfig(key: string): Promise<string>;
	addRemote(name: string, url: string): Promise<void>;
	fetch(options?: FetchOptions): Promise<void>;
	push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
}

export type APIState = 'uninitialized' | 'initialized';

export interface API {
	readonly state: APIState;
	readonly onDidChangeState: Event<APIState>;
	readonly git: Git;
	readonly repositories: Repository[];
	readonly onDidOpenRepository: Event<Repository>;
	readonly onDidCloseRepository: Event<Repository>;
}

export interface GitExtension {
	readonly enabled: boolean;
	getAPI(version: 1): API;
}
