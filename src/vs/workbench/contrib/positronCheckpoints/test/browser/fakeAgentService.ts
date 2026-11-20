/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { Job, JobOutcome } from '../../common/agent/jobTypes.js';

/** One job the view asked the fake agent to run. */
export interface IFakeAgentRun {
	job: string;
	input: unknown;
	token: CancellationToken;
}

/** The answer of the fake agent to one job: an outcome, or a function of the input. */
export type FakeAgentAnswer = JobOutcome<unknown> | ((input: unknown, token: CancellationToken) => Promise<JobOutcome<unknown>>);

/**
 * An agent service for view tests. The test sets `available` with `setAvailable`, and the answer
 * to each job by its name in `answers`; a job with no answer ends with `unavailable`. Every run
 * is recorded in `runs`. The disclosure notice never shows.
 */
export class FakeCheckpointsAgentService extends Disposable implements ICheckpointsAgentService {
	declare readonly _serviceBrand: undefined;

	readonly runs: IFakeAgentRun[] = [];
	readonly answers = new Map<string, FakeAgentAnswer>();

	readonly pendingDisclosure = false;
	readonly onDidChangePendingDisclosure: Event<void> = Event.None;

	private _available: boolean;
	private readonly _onDidChangeAvailable = this._register(new Emitter<void>());
	readonly onDidChangeAvailable = this._onDidChangeAvailable.event;

	constructor(available = true) {
		super();
		this._available = available;
	}

	get available(): boolean {
		return this._available;
	}

	setAvailable(available: boolean): void {
		this._available = available;
		this._onDidChangeAvailable.fire();
	}

	/**
	 * Makes the next run of `job` wait. The returned function answers it with the given outcome.
	 */
	hold(job: string): (outcome: JobOutcome<unknown>) => void {
		let release!: (outcome: JobOutcome<unknown>) => void;
		const answer = new Promise<JobOutcome<unknown>>(resolve => { release = resolve; });
		this.answers.set(job, () => answer);
		return release;
	}

	/** The runs of one job, in order. */
	runsOf(job: string): IFakeAgentRun[] {
		return this.runs.filter(run => run.job === job);
	}

	async answerDisclosure(): Promise<void> { }

	async run<I, O>(job: Job<I, O>, input: I, token: CancellationToken): Promise<JobOutcome<O>> {
		this.runs.push({ job: job.name, input, token });
		const answer = this.answers.get(job.name);
		const outcome = answer === undefined
			? { ok: false as const, reason: 'unavailable' as const }
			: typeof answer === 'function' ? await answer(input, token) : answer;
		// The view receives what the test chose; the test is responsible for its shape.
		return outcome as JobOutcome<O>;
	}
}
