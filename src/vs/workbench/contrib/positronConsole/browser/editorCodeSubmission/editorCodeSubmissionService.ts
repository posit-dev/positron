/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './editorStatementRangeBarberpole.css';

// Other dependencies.
import { URI } from '../../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IEditor, IEditorDecorationsCollection } from '../../../../../editor/common/editorCommon.js';
import { IModelDecorationOptions, ITextModel, TrackedRangeStickiness } from '../../../../../editor/common/model.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

/**
 * The delay, in milliseconds, before the gutter barber pole is shown. Matches the
 * console's input-line submitting visuals (see consoleInput.tsx) so quick
 * statement range checks don't flash any UI.
 */
export const BARBERPOLE_DELAY_MS = 400;

/**
 * The delay, in milliseconds, before the "Submitting" action bar widget is shown.
 * Matches the console's "Submitting..." overlay (see consoleInstance.tsx).
 */
export const WIDGET_DELAY_MS = 1000;

/**
 * Decoration options for the gutter barber pole shown while a statement range is
 * being detected. The `editor-statement-range-detecting` class carries the fade
 * in and the moving stripes (see editorStatementRangeBarberpole.css).
 */
const barberpoleDecorationOptions: IModelDecorationOptions = {
	description: 'positron-statement-range-detecting',
	isWholeLine: true,
	linesDecorationsClassName: 'editor-statement-range-detecting',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
};

/**
 * The outcome of racing a statement range provider against the user's decision.
 */
export type StatementRangeDetectionOutcome<T> =
	/** The provider work resolved with a value. */
	| { readonly kind: 'result'; readonly value: T }
	/** The provider work rejected. */
	| { readonly kind: 'error'; readonly error: unknown }
	/** The user chose to cancel the submission entirely. */
	| { readonly kind: 'cancel' }
	/** The user chose to run the code as-is (skip the provider). */
	| { readonly kind: 'runAsIs' };

/**
 * A single statement range detection session. The caller races the provider work
 * against the user's Cancel / Run as Is decision via {@link wait}, then disposes
 * the session to tear down any visuals.
 */
export interface IStatementRangeDetection extends IDisposable {
	/**
	 * A cancellation token that is cancelled when the user chooses Cancel or Run
	 * as Is. Pass it to the statement range provider so a cancellation-aware
	 * provider can abort early.
	 */
	readonly token: CancellationToken;

	/**
	 * Waits for the provider work, racing it against the user's Cancel / Run as Is
	 * decision.
	 * @param work The statement range provider promise.
	 * @returns The outcome of the race.
	 */
	wait<T>(work: Promise<T>): Promise<StatementRangeDetectionOutcome<T>>;
}

/**
 * The active submission state exposed to the "Submitting" action bar widget. Only
 * set once the {@link WIDGET_DELAY_MS} threshold has been crossed.
 */
export interface IActiveCodeSubmission {
	/** The URI of the document whose statement is being detected. */
	readonly uri: URI;

	/** The one-based line number where the statement is being detected. */
	readonly line: number;
}

export const IEditorCodeSubmissionService =
	createDecorator<IEditorCodeSubmissionService>('editorCodeSubmissionService');

/**
 * A service that provides visual feedback while code submitted from an editor is
 * being prepared for execution. When a statement range provider is consulted to
 * determine which statement to run, this service fades a barber pole into the
 * editor gutter after a short delay and, if the provider is slow, surfaces a
 * "Submitting" widget in the editor action bar with Cancel / Run as Is actions.
 *
 * This makes feedback for code run from the editor symmetric with the feedback
 * shown for code submitted directly in the console.
 */
export interface IEditorCodeSubmissionService {
	readonly _serviceBrand: undefined;

	/**
	 * An event that fires when {@link activeSubmission} changes, so the action bar
	 * widget can re-render.
	 */
	readonly onDidChangeState: Event<void>;

	/**
	 * The active submission that has crossed the widget threshold, or `undefined`
	 * if no submission is currently slow enough to warrant the widget.
	 */
	readonly activeSubmission: IActiveCodeSubmission | undefined;

	/**
	 * Begins a statement range detection session for the given editor.
	 * @param editor The editor the code is being submitted from, if any. Used to
	 *   draw the gutter barber pole; may be `undefined` when code is submitted
	 *   without a visible editor (e.g. via the extension API).
	 * @param model The text model containing the code.
	 * @param line The one-based line number where the statement is being detected.
	 * @returns A detection session; dispose it when detection completes.
	 */
	beginStatementRangeDetection(editor: IEditor | undefined, model: ITextModel, line: number): IStatementRangeDetection;

	/**
	 * Cancels the active submission entirely. Called by the widget's Cancel action.
	 */
	cancel(): void;

	/**
	 * Runs the active submission's code as-is, skipping the statement range
	 * provider. Called by the widget's Run as Is action.
	 */
	runAsIs(): void;
}

/**
 * A statement range detection session. Owns the timers, the gutter decoration,
 * and the deferred user decision for a single submission.
 */
class StatementRangeDetectionSession extends Disposable implements IStatementRangeDetection {
	/** Cancelled when the user makes a decision. */
	private readonly _cts = this._register(new CancellationTokenSource());

	/** Resolves when the user chooses Cancel or Run as Is. */
	private readonly _decision = new DeferredPromise<'cancel' | 'runAsIs'>();

	/** The gutter barber pole decoration, created once the barber pole delay elapses. */
	private _decorations: IEditorDecorationsCollection | undefined;

	private _barberpoleTimer: ReturnType<typeof setTimeout> | undefined;
	private _widgetTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly _editor: IEditor | undefined,
		private readonly _model: ITextModel,
		private readonly _line: number,
		private readonly _onWidgetThreshold: (submission: IActiveCodeSubmission) => void,
		private readonly _onDispose: (session: StatementRangeDetectionSession) => void,
	) {
		super();

		// After the barber pole delay, fade the barber pole into the editor gutter
		// (if there is an editor to draw it in).
		this._barberpoleTimer = setTimeout(() => {
			this._barberpoleTimer = undefined;
			if (this._editor) {
				this._decorations = this._editor.createDecorationsCollection([{
					range: new Range(this._line, 1, this._line, 1),
					options: barberpoleDecorationOptions,
				}]);
			}
		}, BARBERPOLE_DELAY_MS);

		// After the widget delay, surface the "Submitting" action bar widget.
		this._widgetTimer = setTimeout(() => {
			this._widgetTimer = undefined;
			this._onWidgetThreshold({ uri: this._model.uri, line: this._line });
		}, WIDGET_DELAY_MS);
	}

	get token(): CancellationToken {
		return this._cts.token;
	}

	async wait<T>(work: Promise<T>): Promise<StatementRangeDetectionOutcome<T>> {
		// Map the provider work so it never rejects: this keeps a late provider
		// rejection (arriving after the user has already decided, so the race has
		// resolved) from becoming an unhandled rejection.
		const workOutcome: Promise<StatementRangeDetectionOutcome<T>> = work.then(
			value => ({ kind: 'result', value }),
			error => ({ kind: 'error', error }),
		);
		const decisionOutcome: Promise<StatementRangeDetectionOutcome<T>> =
			this._decision.p.then(kind => ({ kind }));
		return Promise.race([workOutcome, decisionOutcome]);
	}

	/** Resolves the user's decision, cancelling the token so the provider can abort. */
	decide(decision: 'cancel' | 'runAsIs'): void {
		if (!this._decision.isSettled) {
			this._decision.complete(decision);
		}
		this._cts.cancel();
	}

	override dispose(): void {
		if (this._barberpoleTimer !== undefined) {
			clearTimeout(this._barberpoleTimer);
			this._barberpoleTimer = undefined;
		}
		if (this._widgetTimer !== undefined) {
			clearTimeout(this._widgetTimer);
			this._widgetTimer = undefined;
		}
		this._decorations?.clear();
		this._decorations = undefined;
		this._onDispose(this);
		super.dispose();
	}
}

/**
 * The {@link IEditorCodeSubmissionService} implementation.
 */
export class EditorCodeSubmissionService extends Disposable implements IEditorCodeSubmissionService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeStateEmitter = this._register(new Emitter<void>());
	readonly onDidChangeState = this._onDidChangeStateEmitter.event;

	/** The current detection session, if any. */
	private _currentSession: StatementRangeDetectionSession | undefined;

	private _activeSubmission: IActiveCodeSubmission | undefined;

	get activeSubmission(): IActiveCodeSubmission | undefined {
		return this._activeSubmission;
	}

	beginStatementRangeDetection(editor: IEditor | undefined, model: ITextModel, line: number): IStatementRangeDetection {
		// Only one submission is tracked at a time; if a previous session is still
		// around, dispose it so its visuals don't linger.
		this._currentSession?.dispose();

		const session = new StatementRangeDetectionSession(
			editor,
			model,
			line,
			submission => {
				// The widget threshold was crossed; publish the active submission.
				if (this._currentSession === session) {
					this._activeSubmission = submission;
					this._onDidChangeStateEmitter.fire();
				}
			},
			disposed => {
				// The session was disposed; clear it as the current session and hide
				// the widget if it was showing this submission.
				if (this._currentSession === disposed) {
					this._currentSession = undefined;
					if (this._activeSubmission) {
						this._activeSubmission = undefined;
						this._onDidChangeStateEmitter.fire();
					}
				}
			},
		);
		this._currentSession = session;
		return session;
	}

	cancel(): void {
		this._currentSession?.decide('cancel');
	}

	runAsIs(): void {
		this._currentSession?.decide('runAsIs');
	}

	override dispose(): void {
		this._currentSession?.dispose();
		this._currentSession = undefined;
		super.dispose();
	}
}
