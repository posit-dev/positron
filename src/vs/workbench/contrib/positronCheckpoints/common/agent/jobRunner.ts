/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ModelSelection, StreamTextResult } from '../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { ILanguageModelMessage } from '../../../../../platform/positronHeadlessLanguageModel/common/engine.js';
import { extractJson, Job, JobOutcome, STYLE_RULES } from './jobTypes.js';

// The parts of running a job that need no services: the full system prompt, the cache key, the
// response cache, and one model request with its checks. `ICheckpointsAgentService` adds the
// settings, the disclosure notice, and the storage.

/** The number of characters of a model answer that are read. A longer answer fails the check. */
export const MAX_RESPONSE_CHARS = 200000;

/** The number of answers kept in the cache. */
export const MAX_CACHE_ENTRIES = 200;

/** The prefix of every storage key of the agent. */
export const AGENT_STORAGE_PREFIX = 'positronCheckpoints.agent';

/** The last instruction of every system prompt. */
const JSON_ONLY = 'Answer with one JSON object only, with no text before or after it.';

/** The system prompt sent for a job: the job's own prompt, the style rules, and the JSON instruction. */
export function fullSystemPrompt(jobSystemPrompt: string): string {
	return [jobSystemPrompt, STYLE_RULES, JSON_ONLY].join('\n\n');
}

/**
 * The cache key of a request: the job name and version, and a SHA-256 hash of the model setting,
 * the system prompt, and the user prompt. A change to any of them gives a new key, so a changed
 * model setting never answers with text from another model.
 */
export async function cacheKey(job: Job<unknown, unknown>, modelSetting: readonly string[] | undefined, systemPrompt: string, user: string): Promise<string> {
	const hashed = JSON.stringify([modelSetting ?? [], systemPrompt, user]);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashed));
	const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
	return `${AGENT_STORAGE_PREFIX}.${job.name}.${job.version}.${hex}`;
}

/** The storage a `JobCache` uses: one string value per key, kept for the workspace. */
export interface IJobCacheStorage {
	get(key: string): string | undefined;
	store(key: string, value: string): void;
	remove(key: string): void;
}

/**
 * Checked job outputs, at most `MAX_CACHE_ENTRIES`. Each output is stored under its own key, and
 * an index key lists the keys from least to most recently used. Adding past the limit removes the
 * least recently used output.
 */
export class JobCache {
	static readonly INDEX_KEY = `${AGENT_STORAGE_PREFIX}.cacheIndex`;

	constructor(private readonly _storage: IJobCacheStorage, private readonly _maxEntries = MAX_CACHE_ENTRIES) { }

	/** The output stored under `key`, or undefined when there is none or it cannot be read. */
	get<T>(key: string): T | undefined {
		const stored = this._storage.get(key);
		if (stored === undefined) {
			return undefined;
		}
		let value: T;
		try {
			value = JSON.parse(stored) as T;
		} catch {
			this._storage.remove(key);
			this._writeIndex(this._readIndex().filter(entry => entry !== key));
			return undefined;
		}
		this._writeIndex([...this._readIndex().filter(entry => entry !== key), key]);
		return value;
	}

	/** Stores a checked output under `key`, removing the least recently used ones past the limit. */
	set(key: string, value: unknown): void {
		const index = [...this._readIndex().filter(entry => entry !== key), key];
		while (index.length > this._maxEntries) {
			const oldest = index.shift();
			if (oldest !== undefined) {
				this._storage.remove(oldest);
			}
		}
		this._storage.store(key, JSON.stringify(value));
		this._writeIndex(index);
	}

	private _readIndex(): string[] {
		const stored = this._storage.get(JobCache.INDEX_KEY);
		if (stored === undefined) {
			return [];
		}
		try {
			const parsed: unknown = JSON.parse(stored);
			return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
		} catch {
			return [];
		}
	}

	private _writeIndex(index: string[]): void {
		this._storage.store(JobCache.INDEX_KEY, JSON.stringify(index));
	}
}

/** What one model request needs besides the job. */
export interface IModelRequest {
	systemPrompt: string;
	user: string;
	model: ModelSelection;
	streamText(request: { systemPrompt: string; messages: readonly ILanguageModelMessage[]; model: ModelSelection; cancellationToken: CancellationToken }): Promise<StreamTextResult>;
}

/**
 * Sends one request, reads the answer, and checks it. The answer is read until it ends, until
 * `MAX_RESPONSE_CHARS` characters arrived (a failed check), or until the token is cancelled, which
 * is checked between pieces of the answer. A stream that fails partway gives `error`.
 */
export async function requestJob<I, O>(job: Job<I, O>, input: I, request: IModelRequest, token: CancellationToken): Promise<JobOutcome<O>> {
	let text = '';
	try {
		const result = await request.streamText({
			systemPrompt: request.systemPrompt,
			messages: [{ role: 'user', content: request.user }],
			model: request.model,
			cancellationToken: token,
		});
		if (!result.available) {
			return { ok: false, reason: 'unavailable', detail: result.reason };
		}
		for await (const piece of result.text) {
			if (token.isCancellationRequested) {
				return { ok: false, reason: 'cancelled' };
			}
			text += piece;
			if (text.length > MAX_RESPONSE_CHARS) {
				return { ok: false, reason: 'failed-check', detail: 'too-long' };
			}
		}
	} catch (error) {
		return { ok: false, reason: 'error', detail: error instanceof Error ? error.message : String(error) };
	}
	if (token.isCancellationRequested) {
		return { ok: false, reason: 'cancelled' };
	}

	const raw = extractJson(text);
	if (raw === undefined) {
		return { ok: false, reason: 'failed-check', detail: 'no-json' };
	}
	let value: O | undefined;
	try {
		value = job.check(raw, input);
	} catch (error) {
		return { ok: false, reason: 'error', detail: error instanceof Error ? error.message : String(error) };
	}
	return value === undefined
		? { ok: false, reason: 'failed-check', detail: 'rejected' }
		: { ok: true, value, fromCache: false };
}
