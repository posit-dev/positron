/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellation } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IHeadlessLanguageModelService, intentFromSetting, ModelSelection } from '../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { CHECKPOINTS_MODEL_KEY, CHECKPOINTS_SUGGESTIONS_ENABLED_KEY } from '../common/checkpointsConfiguration.js';
import { AGENT_STORAGE_PREFIX, cacheKey, fullSystemPrompt, JobCache, requestJob } from '../common/agent/jobRunner.js';
import { Job, JobOutcome, JobWeight } from '../common/agent/jobTypes.js';

export const ICheckpointsAgentService = createDecorator<ICheckpointsAgentService>('positronCheckpointsAgentService');

/** The answers to the disclosure notice. */
export type DisclosureChoice = 'ok' | 'turn-off';

/**
 * Runs the jobs of the Checkpoints agent (spec 7): gates every model call on `ai.enabled` and
 * `checkpoints.suggestions.enabled`, answers repeated requests from a workspace cache, and shows a
 * one-time notice in the view before the first model call of a workspace.
 */
export interface ICheckpointsAgentService {
	readonly _serviceBrand: undefined;

	/** True while `ai.enabled` and `checkpoints.suggestions.enabled` are both true, read live. */
	readonly available: boolean;

	/** Fires when `available` changes. */
	readonly onDidChangeAvailable: Event<void>;

	/**
	 * True while a job waits for the person to answer the disclosure notice. The view shows the
	 * notice as a card while this is true.
	 */
	readonly pendingDisclosure: boolean;

	/** Fires when `pendingDisclosure` changes. */
	readonly onDidChangePendingDisclosure: Event<void>;

	/**
	 * Answers the disclosure notice. `ok` records that the notice was seen in this workspace, and
	 * the waiting jobs continue. `turn-off` turns off `checkpoints.suggestions.enabled`, and the
	 * waiting jobs end with `suggestions-off`.
	 */
	answerDisclosure(choice: DisclosureChoice): Promise<void>;

	/** Runs one job. Never throws: every failure is an outcome with a reason. */
	run<I, O>(job: Job<I, O>, input: I, token: CancellationToken): Promise<JobOutcome<O>>;
}

/** The answer a waiting job receives: a choice, or `withdrawn` when the agent became unavailable. */
type DisclosureAnswer = DisclosureChoice | 'withdrawn';

export class CheckpointsAgentService extends Disposable implements ICheckpointsAgentService {
	declare readonly _serviceBrand: undefined;

	/** Set to true in workspace storage once the person answered OK to the disclosure notice. */
	static readonly DISCLOSED_KEY = `${AGENT_STORAGE_PREFIX}.disclosed`;

	private readonly _cache: JobCache;

	private _available: boolean;
	private readonly _onDidChangeAvailable = this._register(new Emitter<void>());
	readonly onDidChangeAvailable = this._onDidChangeAvailable.event;

	/** The answer every waiting job shares, while the notice is shown. */
	private _disclosure: { promise: Promise<DisclosureAnswer>; resolve(answer: DisclosureAnswer): void } | undefined;
	private readonly _onDidChangePendingDisclosure = this._register(new Emitter<void>());
	readonly onDidChangePendingDisclosure = this._onDidChangePendingDisclosure.event;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IStorageService private readonly _storageService: IStorageService,
		@IHeadlessLanguageModelService private readonly _languageModelService: IHeadlessLanguageModelService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._cache = new JobCache({
			get: key => this._storageService.get(key, StorageScope.WORKSPACE),
			store: (key, value) => this._storageService.store(key, value, StorageScope.WORKSPACE, StorageTarget.MACHINE),
			remove: key => this._storageService.remove(key, StorageScope.WORKSPACE),
		});
		this._available = this._readAvailable();
		this._register(this._configurationService.onDidChangeConfiguration(event => {
			if (!event.affectsConfiguration(AI_ENABLED_KEY) && !event.affectsConfiguration(CHECKPOINTS_SUGGESTIONS_ENABLED_KEY)) {
				return;
			}
			const available = this._readAvailable();
			if (available === this._available) {
				return;
			}
			this._available = available;
			if (!available) {
				// The notice goes away, and the jobs waiting on it end with the reason that applies.
				this._settleDisclosure('withdrawn');
			}
			this._onDidChangeAvailable.fire();
		}));
	}

	get available(): boolean {
		return this._readAvailable();
	}

	get pendingDisclosure(): boolean {
		return this._disclosure !== undefined;
	}

	async answerDisclosure(choice: DisclosureChoice): Promise<void> {
		if (choice === 'ok') {
			this._storageService.store(CheckpointsAgentService.DISCLOSED_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} else {
			try {
				await this._configurationService.updateValue(CHECKPOINTS_SUGGESTIONS_ENABLED_KEY, false);
			} catch (error) {
				this._logService.error('The suggestions setting could not be turned off.', error);
			}
		}
		this._settleDisclosure(choice);
	}

	async run<I, O>(job: Job<I, O>, input: I, token: CancellationToken): Promise<JobOutcome<O>> {
		const gated = this._gate();
		if (gated) {
			return gated;
		}
		if (token.isCancellationRequested) {
			return { ok: false, reason: 'cancelled' };
		}

		let systemPrompt: string;
		let user: string;
		let key: string;
		const modelSetting = this._modelSetting();
		try {
			const prompt = job.buildPrompt(input);
			systemPrompt = fullSystemPrompt(prompt.systemPrompt);
			user = prompt.user;
			key = await cacheKey(job, modelSetting, systemPrompt, user);
		} catch (error) {
			this._logService.error(`The checkpoints job ${job.name} could not build its request.`, error);
			return { ok: false, reason: 'error', detail: error instanceof Error ? error.message : String(error) };
		}

		const cached = this._cache.get<O>(key);
		if (cached !== undefined) {
			return { ok: true, value: cached, fromCache: true };
		}

		const answer = await this._waitForDisclosure(token);
		if (answer === 'cancelled' || token.isCancellationRequested) {
			return { ok: false, reason: 'cancelled' };
		}
		if (answer === 'turn-off') {
			return { ok: false, reason: 'suggestions-off' };
		}
		// The settings are read again right before the call, because they can change while the
		// notice waits.
		const gatedAgain = this._gate();
		if (gatedAgain) {
			return gatedAgain;
		}

		const outcome = await requestJob(job, input, {
			systemPrompt,
			user,
			model: this._selectionFor(job.weight),
			streamText: request => this._languageModelService.streamText(request),
		}, token);
		if (outcome.ok) {
			this._cache.set(key, outcome.value);
		} else if (outcome.reason === 'error') {
			this._logService.error(`The checkpoints job ${job.name} failed: ${outcome.detail}`);
		} else if (outcome.reason !== 'cancelled') {
			this._logService.info(`The checkpoints job ${job.name} gave no output: ${outcome.reason} ${outcome.detail ?? ''}`.trim());
		}
		return outcome;
	}

	/** The outcome for a closed gate, or undefined when the model may be called. */
	private _gate(): JobOutcome<never> | undefined {
		if (this._configurationService.getValue<boolean>(AI_ENABLED_KEY) !== true) {
			return { ok: false, reason: 'ai-off' };
		}
		if (this._configurationService.getValue<boolean>(CHECKPOINTS_SUGGESTIONS_ENABLED_KEY) !== true) {
			return { ok: false, reason: 'suggestions-off' };
		}
		return undefined;
	}

	private _readAvailable(): boolean {
		return this._gate() === undefined;
	}

	private _modelSetting(): readonly string[] | undefined {
		return this._configurationService.getValue<string[]>(CHECKPOINTS_MODEL_KEY);
	}

	/** The model for a job of the given weight. Both weights use `checkpoints.model` today. */
	private _selectionFor(_weight: JobWeight): ModelSelection {
		return intentFromSetting(this._modelSetting());
	}

	/**
	 * Resolves at once when the notice was answered with OK in this workspace. Otherwise shows the
	 * notice, unless it already shows, and waits for the answer that every waiting job shares.
	 */
	private async _waitForDisclosure(token: CancellationToken): Promise<DisclosureAnswer | 'cancelled'> {
		if (this._storageService.getBoolean(CheckpointsAgentService.DISCLOSED_KEY, StorageScope.WORKSPACE, false)) {
			return 'ok';
		}
		if (!this._disclosure) {
			let resolve!: (answer: DisclosureAnswer) => void;
			const promise = new Promise<DisclosureAnswer>(r => { resolve = r; });
			this._disclosure = { promise, resolve };
			this._onDidChangePendingDisclosure.fire();
		}
		return raceCancellation(this._disclosure.promise, token, 'cancelled');
	}

	private _settleDisclosure(answer: DisclosureAnswer): void {
		const disclosure = this._disclosure;
		if (!disclosure) {
			return;
		}
		this._disclosure = undefined;
		disclosure.resolve(answer);
		this._onDidChangePendingDisclosure.fire();
	}
}

registerSingleton(ICheckpointsAgentService, CheckpointsAgentService, InstantiationType.Delayed);
