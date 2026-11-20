/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RejectedReason } from './types';

export interface GitResult { stdout: string; stderr: string; exitCode: number; timedOut: boolean }
export type GitRunner = (args: string[], options?: { env?: Record<string, string>; stdin?: string | Uint8Array; binary?: boolean; timeoutMs?: number }) => Promise<GitResult>;
export interface FilePort {
	read(path: string): Promise<Uint8Array | undefined>;
	write(path: string, content: Uint8Array, executable: boolean): Promise<void>;
	remove(path: string): Promise<void>;
	move(from: string, to: string): Promise<void>;
	stat(path: string): Promise<{ sizeBytes: number; isDirectory: boolean } | undefined>;
	appendDurable(path: string, line: string): Promise<void>;
	caseInsensitive(): Promise<boolean>;
}
export type NetworkResult = { ok: true } | { ok: false; reason: RejectedReason; detail: string };
export interface NetworkPort { fetch(): Promise<NetworkResult>; push(branch: string): Promise<NetworkResult> }
export interface EnginePorts { git: GitRunner; files: FilePort; network: NetworkPort; now: () => Date; newId: () => string; projectRoot: string; openedFolder: string }
