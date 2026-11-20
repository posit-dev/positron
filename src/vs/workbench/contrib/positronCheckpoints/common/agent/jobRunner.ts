/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { StringSHA1 } from '../../../../../base/common/hash.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { ModelSelection, StreamTextResult } from '../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { ILanguageModelMessage } from '../../../../../platform/positronHeadlessLanguageModel/common/engine.js';
import { extractJson, Job, JobOutcome, STYLE_RULES, withoutDataTokens } from './jobTypes.js';

// The parts of running a job that need no services: the full system prompt, the cache key, the
// response cache, and one model request with its checks. `ICheckpointsAgentService` adds the
// settings, the disclosure notice, and the storage.

/** The number of characters of a model answer that are read. A longer answer fails the check. */
export const MAX_RESPONSE_CHARS = 200000;

/** The number of answers kept in the cache. */
export const MAX_CACHE_ENTRIES = 200;

/** The longest stored form of an answer, in characters, that is cached. A longer answer is not. */
export const MAX_CACHED_VALUE_CHARS = 20000;

/** The shortest time between two writes of the cache index to storage. */
export const INDEX_WRITE_DELAY_MS = 2000;

/** The prefix of every storage key of the agent. */
export const AGENT_STORAGE_PREFIX = 'positronCheckpoints.agent';

/** The last instruction of every system prompt. */
const JSON_ONLY = 'Answer with one JSON object only, with no text before or after it.';

/** The system prompt sent for a job: the job's own prompt, the style rules, and the JSON instruction. */
export function fullSystemPrompt(jobSystemPrompt: string): string {
	return [jobSystemPrompt, STYLE_RULES, JSON_ONLY].join('\n\n');
}

/**
 * The cache key of a request: the job name and version, and a SHA-1 hash of the model setting,
 * the system prompt, and the user prompt. A change to any of them gives a new key, so a changed
 * model setting never answers with text from another model. The random tokens of the
 * `wrapUntrusted` marker lines are left out of the hash, so the same content gives the same key.
 * The hash is computed synchronously, so it works on every web origin.
 */
export function cacheKey(job: Job<unknown, unknown>, modelSetting: readonly string[] | undefined, systemPrompt: string, user: string): string {
	const sha1 = new StringSHA1();
	sha1.update(JSON.stringify([modelSetting ?? [], withoutDataTokens(systemPrompt), withoutDataTokens(user)]));
	return `${AGENT_STORAGE_PREFIX}.${job.name}.${job.version}.${sha1.digest()}`;
}

/** The storage a `JobCache` uses: one string value per key, kept for the workspace. */
export interface IJobCacheStorage {
	get(key: string): string | undefined;
	store(key: string, value: string): void;
	remove(key: string): void;
}

/**
 * Checked job outputs, at most `MAX_CACHE_ENTRIES`, each at most `MAX_CACHED_VALUE_CHARS` long
 * when stored. Each output is stored under its own key, and an index key lists the keys from least
 * to most recently used. Adding past the limit removes the least recently used output. The index
 * is kept in memory and written to storage at most once per `INDEX_WRITE_DELAY_MS`, and on
 * `flush` or disposal.
 */
export class JobCache implements IDisposable {
	static readonly INDEX_KEY = `${AGENT_STORAGE_PREFIX}.cacheIndex`;

	/** The index, read from storage on first use. */
	private _index: string[] | undefined;
	private readonly _indexWrite: RunOnceScheduler;

	constructor(private readonly _storage: IJobCacheStorage, private readonly _maxEntries = MAX_CACHE_ENTRIES) {
		this._indexWrite = new RunOnceScheduler(() => this.flush(), INDEX_WRITE_DELAY_MS);
	}

	/** Writes the index to storage now, once it has been read or changed. */
	flush(): void {
		this._indexWrite.cancel();
		if (this._index !== undefined) {
			this._storage.store(JobCache.INDEX_KEY, JSON.stringify(this._index));
		}
	}

	dispose(): void {
		if (this._indexWrite.isScheduled()) {
			this.flush();
		}
		this._indexWrite.dispose();
	}

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
			this.remove(key);
			return undefined;
		}
		this._writeIndex([...this._readIndex().filter(entry => entry !== key), key]);
		return value;
	}

	/** Removes the output stored under `key`, if any. */
	remove(key: string): void {
		this._storage.remove(key);
		this._writeIndex(this._readIndex().filter(entry => entry !== key));
	}

	/**
	 * Stores a checked output under `key`, removing the least recently used ones past the limit.
	 * An output longer than `MAX_CACHED_VALUE_CHARS` when stored is not cached.
	 */
	set(key: string, value: unknown): void {
		const stored = JSON.stringify(value);
		if (stored.length > MAX_CACHED_VALUE_CHARS) {
			return;
		}
		const index = [...this._readIndex().filter(entry => entry !== key), key];
		while (index.length > this._maxEntries) {
			const oldest = index.shift();
			if (oldest !== undefined) {
				this._storage.remove(oldest);
			}
		}
		this._storage.store(key, stored);
		this._writeIndex(index);
	}

	private _readIndex(): string[] {
		if (this._index === undefined) {
			this._index = JobCache._parseIndex(this._storage.get(JobCache.INDEX_KEY));
		}
		return this._index;
	}

	private static _parseIndex(stored: string | undefined): string[] {
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

	/** Replaces the index in memory, and writes it to storage within `INDEX_WRITE_DELAY_MS`. */
	private _writeIndex(index: string[]): void {
		this._index = index;
		if (!this._indexWrite.isScheduled()) {
			this._indexWrite.schedule();
		}
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
