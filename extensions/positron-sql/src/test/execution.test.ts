/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as vscode from 'vscode';
import {
	chooseLanguage,
	ConnectionCandidate,
	ConnectionChoice,
	connectionCandidates,
	consoleSessionFor,
	ExecutionApi,
	holdsVariable,
	StatementRunner,
} from '../execution';
import { ConnectionRef } from '../schema';
import { sqlDocument, testLog, TEST_CONNECTION, TEST_DRIVER, TEST_PROFILE } from './support';

const CONNECTION: ConnectionRef = {
	profileId: TEST_PROFILE,
	name: TEST_CONNECTION,
	driverId: TEST_DRIVER,
};

suite('chooseLanguage', () => {

	test('the session in front of the user wins when the driver supports it', () => {
		// It holds their other objects and its output is what they are reading. Sending the result
		// somewhere they cannot see would be a surprise even though it would work.
		assert.deepStrictEqual(
			chooseLanguage(['python', 'r'], 'r', 'python'),
			{ kind: 'language', languageId: 'r' },
		);
	});

	test('a foreground session the driver cannot connect from is passed over', () => {
		assert.deepStrictEqual(
			chooseLanguage(['r'], 'python', undefined),
			{ kind: 'language', languageId: 'r' },
		);
	});

	test('the language the file was last run in decides when no session does', () => {
		assert.deepStrictEqual(
			chooseLanguage(['python', 'r'], undefined, 'python'),
			{ kind: 'language', languageId: 'python' },
		);
	});

	test('a remembered language the driver no longer supports is ignored', () => {
		assert.deepStrictEqual(
			chooseLanguage(['r'], undefined, 'python'),
			{ kind: 'language', languageId: 'r' },
		);
	});

	test('a driver with one language needs no question', () => {
		assert.deepStrictEqual(
			chooseLanguage(['python'], undefined, undefined),
			{ kind: 'language', languageId: 'python' },
		);
	});

	test('a driver with several and nothing to go on asks', () => {
		assert.deepStrictEqual(
			chooseLanguage(['python', 'r'], undefined, undefined),
			{ kind: 'ask', candidates: ['python', 'r'] },
		);
	});

	test('a driver that generates no connection code has no language at all', () => {
		// Its connections can be browsed in the pane, but there is no way to hand one to a session.
		assert.deepStrictEqual(chooseLanguage([], 'r', 'r'), { kind: 'none' });
	});
});

suite('consoleSessionFor', () => {

	test('the foreground session is used when it speaks the language', () => {
		assert.strictEqual(
			consoleSessionFor('r', session('fg', 'r'), [session('other', 'r'), session('fg', 'r')]),
			'fg',
		);
	});

	test('another console session is used when the foreground one speaks something else', () => {
		assert.strictEqual(
			consoleSessionFor('r', session('fg', 'python'), [session('rs', 'r')]),
			'rs',
		);
	});

	test('a notebook session is not used', () => {
		// It belongs to a notebook the user is not editing, and its output would land in a cell.
		assert.strictEqual(
			consoleSessionFor('r', undefined, [session('nb', 'r', positron.LanguageRuntimeSessionMode.Notebook)]),
			undefined,
		);
	});

	test('nothing running for the language is not a failure', () => {
		// It means nobody has connected yet, and connecting is what starts the session.
		assert.strictEqual(consoleSessionFor('r', undefined, []), undefined);
	});
});

suite('holdsVariable', () => {

	test('a session that still has the variable holds the connection', () => {
		assert.strictEqual(holdsVariable([[variable('con')]], 'con'), true);
	});

	test('a session that answered with nothing does not', () => {
		// What a name the session does not have looks like, and the reason a binding is confirmed
		// rather than trusted: the user is free to remove the variable.
		assert.strictEqual(holdsVariable([[]], 'con'), false);
		assert.strictEqual(holdsVariable([], 'con'), false);
	});

	test('a different variable does not count', () => {
		assert.strictEqual(holdsVariable([[variable('conn')]], 'con'), false);
	});
});

suite('connectionCandidates', () => {

	const RECORDED: positron.DataConnectionBinding = {
		profileId: 'other',
		sessionId: 'r-session',
		languageId: 'r',
		variantId: 'dbi',
		variableName: 'sales',
	};

	test('a variable Positron connected is offered, with what it knows about it', () => {
		assert.deepStrictEqual(
			connectionCandidates([[typed('sales', 'PqConnection')]], [RECORDED]),
			[{ variableName: 'sales', displayType: 'PqConnection', binding: RECORDED }],
		);
	});

	test('a connection the user made by hand is offered too, with no binding', () => {
		// Connecting in the console is an ordinary thing to do, and a connection made that way is
		// as usable as one Positron made.
		assert.deepStrictEqual(
			connectionCandidates([[typed('con', 'duckdb_connection')]], []),
			[{ variableName: 'con', displayType: 'duckdb_connection', binding: undefined }],
		);
	});

	test('a SQLAlchemy engine counts, its type saying engine rather than connection', () => {
		assert.deepStrictEqual(
			connectionCandidates([[typed('engine', 'Engine')]], []).map(each => each.variableName),
			['engine'],
		);
	});

	test('an ordinary variable is not offered', () => {
		assert.deepStrictEqual(connectionCandidates([[typed('orders', 'data.frame')]], []), []);
	});

	test('a recorded variable is offered whatever its type says', () => {
		// Positron made it, which settles the question; requiring the type to also look like a
		// connection would drop connections Positron itself opened.
		assert.deepStrictEqual(
			connectionCandidates([[typed('sales', 'S4')]], [RECORDED]).map(each => each.variableName),
			['sales'],
		);
	});
});

suite('StatementRunner', () => {

	test('a connection the session already holds is used without any prompt', async () => {
		// The whole point of remembering: connecting once should not mean answering a dialog on
		// every statement afterwards.
		const { runner, calls } = harness();

		const outcome = await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.strictEqual(outcome.kind, 'executed');
		assert.deepStrictEqual(calls.connectedWith, []);
		assert.deepStrictEqual(calls.picked, []);
		assert.deepStrictEqual(calls.executed, [{
			languageId: 'r',
			sessionId: 'r-session',
			code: 'DBI::dbGetQuery(con, "SELECT 1")',
		}]);
	});

	test('a session holding nothing at all goes straight to the Connect With dialog', async () => {
		// There would be one entry in the pick and it would say "create a new connection", which
		// is a question with one answer.
		const { runner, calls } = harness({ bindings: [], variables: [[]] });

		const outcome = await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.strictEqual(outcome.kind, 'executed');
		assert.deepStrictEqual(calls.picked, []);
		assert.deepStrictEqual(calls.connectedWith, [{
			profileId: TEST_PROFILE, languageId: 'r', taken: [],
		}]);
	});

	test('the connections a session already has are offered before a new one is made', async () => {
		// Made for another database, or by hand in the console. Connecting again beside one of
		// these costs a round trip and leaves the user with two of something they wanted one of.
		const { runner, calls } = harness({
			bindings: [],
			variables: [[typed('warehouse', 'PqConnection'), variable('rows')]],
		});

		await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.deepStrictEqual(calls.picked, [[{
			variableName: 'warehouse',
			displayType: 'PqConnection',
			binding: undefined,
		}]]);
	});

	test('picking an existing connection remembers it, so the next statement does not ask', async () => {
		const { runner, calls } = harness({
			bindings: [],
			variables: [[typed('warehouse', 'PqConnection')]],
		});

		const outcome = await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.strictEqual(outcome.kind, 'executed');
		assert.deepStrictEqual(calls.registered, [{
			profileId: TEST_PROFILE,
			sessionId: 'r-session',
			languageId: 'r',
			// None: Positron did not make this one and cannot know which library did.
			variantId: undefined,
			variableName: 'warehouse',
		}]);
	});

	test('dismissing the pick runs nothing', async () => {
		const { runner, calls } = harness({
			bindings: [],
			variables: [[typed('warehouse', 'PqConnection')]],
			choice: undefined,
		});

		const outcome = await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.deepStrictEqual(outcome, { kind: 'cancelled' });
		assert.deepStrictEqual(calls.executed, []);
	});

	test('choosing to create a new connection opens the dialog', async () => {
		const { runner, calls } = harness({
			bindings: [],
			variables: [[typed('warehouse', 'PqConnection')]],
			choice: { kind: 'new' },
		});

		await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.deepStrictEqual(calls.connectedWith, [{
			// The names already in the session travel with the request, so the code the user is
			// shown binds one that is free rather than overwriting `warehouse`.
			profileId: TEST_PROFILE, languageId: 'r', taken: ['warehouse'],
		}]);
	});

	test('a remembered connection whose variable has gone is not written against', async () => {
		// A binding records what was submitted, not what survived: the user is free to remove the
		// variable, and clearing the workspace removes everything.
		const { runner, calls } = harness({ variables: [[]] });

		await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.deepStrictEqual(calls.connectedWith, [{
			profileId: TEST_PROFILE, languageId: 'r', taken: [],
		}]);
	});

	test('a session that cannot be asked about its variables is treated as holding nothing', async () => {
		const { runner, calls } = harness({ variables: () => Promise.reject(new Error('busy')) });

		await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.strictEqual(calls.connectedWith.length, 1);
	});

	test('a connection that failed does not have the query queued behind it', async () => {
		// Otherwise the user gets two errors: the driver's own, and a bewildering "object not
		// found" underneath it from the query running against a variable that was never bound.
		const { runner, calls } = harness({ bindings: [], variables: [[]], connectedVariables: [[]] });

		const outcome = await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.strictEqual(outcome.kind, 'connect-failed');
		assert.deepStrictEqual(calls.executed, []);
	});

	test('the query waits for the connection code to finish before it is queued', async () => {
		const { runner, calls } = harness({ bindings: [], variables: [[]] });

		await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.deepStrictEqual(calls.settled, [{ languageId: 'r', sessionId: 'r-session' }]);
	});

	test('a connection that has not started yet is waited for again, not called failed', async () => {
		// Submitting the connection code and the runtime starting to run it are two moments, and a
		// wait that lands between them returns before the connection has begun.
		let checks = 0;
		const { runner, calls } = harness({
			bindings: [],
			variables: [[]],
			// Empty on the first look, connected by the second: what the gap looks like.
			connectedVariables: () => {
				checks += 1;
				return Promise.resolve(checks > 1 ? [[variable('con')]] : [[]]);
			},
		});

		const outcome = await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.strictEqual(outcome.kind, 'executed');
		assert.strictEqual(calls.settled.length, 2);
	});

	test('dismissing the dialog runs nothing and says nothing', async () => {
		const { runner, calls } = harness({ bindings: [], variables: [[]], connected: undefined });

		const outcome = await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.deepStrictEqual(outcome, { kind: 'cancelled' });
		assert.deepStrictEqual(calls.executed, []);
	});

	test('a connection the user has since removed is reported, not run against', async () => {
		const { runner } = harness({ connections: [] });

		const outcome = await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.deepStrictEqual(outcome, { kind: 'no-connection' });
	});

	test('a driver that cannot be connected from any language is reported', async () => {
		const { runner, calls } = harness({ supportedLanguageIds: [] });

		const outcome = await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.deepStrictEqual(outcome, { kind: 'no-language' });
		assert.deepStrictEqual(calls.executed, []);
	});

	test('a driver that cannot query the connection it made is reported', async () => {
		// A pin board is the case: it connects from R and Python and is not queried with SQL.
		const { runner, calls } = harness({ queryCode: undefined });

		const outcome = await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.strictEqual(outcome.kind, 'no-query-code');
		assert.deepStrictEqual(calls.executed, []);
	});

	test('the user is asked which language only when nothing open says', async () => {
		const { runner, calls } = harness({ foreground: undefined, sessions: [] });

		await runner.run(await document(), CONNECTION, 'SELECT 1', undefined);

		assert.deepStrictEqual(calls.asked, [['python', 'r']]);
	});

	test('the language the file was last run in is not asked about again', async () => {
		const { runner, calls } = harness({ foreground: undefined, sessions: [] });

		await runner.run(await document(), CONNECTION, 'SELECT 1', 'python');

		assert.deepStrictEqual(calls.asked, []);
		assert.strictEqual(calls.connectedWith[0]?.languageId, 'python');
	});

	/**
	 * A runner over a stubbed Positron. The fixture is an R session that already holds this
	 * connection as `con`, which is the case that must not prompt; each option replaces one part of
	 * that, so a test names only the thing it is about.
	 */
	function harness(options: {
		connections?: positron.DataConnectionSummary[];
		supportedLanguageIds?: string[];
		bindings?: positron.DataConnectionBinding[];
		connected?: positron.DataConnectionBinding;
		variables?: positron.RuntimeVariable[][] | (() => Thenable<positron.RuntimeVariable[][]>);
		/** What the session holds once the connection code has run; defaults to holding it. */
		connectedVariables?: positron.RuntimeVariable[][] | (() => Thenable<positron.RuntimeVariable[][]>);
		choice?: ConnectionChoice;
		queryCode?: string;
		foreground?: positron.BaseLanguageRuntimeSession;
		sessions?: positron.BaseLanguageRuntimeSession[];
	} = {}) {
		const held: positron.DataConnectionBinding = {
			profileId: TEST_PROFILE,
			sessionId: 'r-session',
			languageId: 'r',
			variantId: 'dbi',
			variableName: 'con',
		};
		const calls = {
			connectedWith: [] as { profileId: string; languageId: string; taken: readonly string[] }[],
			registered: [] as positron.DataConnectionBinding[],
			executed: [] as { languageId: string; sessionId: string; code: string }[],
			settled: [] as { languageId: string; sessionId: string }[],
			asked: [] as (readonly string[])[],
			picked: [] as (readonly ConnectionCandidate[])[],
		};

		// Distinguishes "the option was not given" from "the option was given as undefined": every
		// interesting case here is something being absent.
		const given = (key: string) => Object.prototype.hasOwnProperty.call(options, key);

		// Set once the connection code has been submitted, so the variable check that follows sees
		// the session as it is afterwards rather than as it was before.
		let connectSubmitted = false;

		const api: ExecutionApi = {
			getConnections: async () => options.connections ?? [{
				profileId: TEST_PROFILE,
				name: TEST_CONNECTION,
				driverId: TEST_DRIVER,
				driverName: 'DuckDB',
				connected: true,
				supportedLanguageIds: options.supportedLanguageIds ?? ['python', 'r'],
			}],
			getSessionBindings: async () => options.bindings ?? [held],
			registerSessionBinding: async binding => { calls.registered.push(binding); },
			connectDataConnectionWith: async (profileId, languageId, connectOptions) => {
				calls.connectedWith.push({
					profileId, languageId, taken: connectOptions.takenVariableNames ?? [],
				});
				connectSubmitted = true;
				return given('connected')
					? options.connected
					: { ...held, languageId, sessionId: `${languageId}-session` };
			},
			generateQueryCode: async (binding, query) => given('queryCode')
				? options.queryCode
				: `DBI::dbGetQuery(${binding.variableName}, "${query}")`,
			getForegroundSession: async () =>
				given('foreground') ? options.foreground : session('r-session', 'r'),
			getActiveSessions: async () => options.sessions ?? [session('r-session', 'r')],
			getSessionVariables: async () => {
				if (connectSubmitted) {
					return typeof options.connectedVariables === 'function'
						? options.connectedVariables()
						: options.connectedVariables ?? [[variable('con')]];
				}
				return typeof options.variables === 'function'
					? options.variables()
					: options.variables ?? [[variable('con')]];
			},
			settle: async (languageId, sessionId) => { calls.settled.push({ languageId, sessionId }); },
			executeCode: async (languageId, code, sessionId) => {
				calls.executed.push({ languageId, sessionId, code });
			},
			pickLanguage: async candidates => {
				calls.asked.push(candidates);
				return candidates[0];
			},
			pickConnection: async candidates => {
				calls.picked.push(candidates);
				return given('choice')
					? options.choice
					: { kind: 'existing', candidate: candidates[0] };
			},
		};

		return { runner: new StatementRunner(api, testLog().log), calls };
	}
});

/** A document for a run to be attributed to; its contents do not matter here. */
function document(): Thenable<vscode.TextDocument> {
	return sqlDocument('SELECT 1');
}

/** A running session, as the runtime API reports one. Only the fields this module reads. */
function session(
	sessionId: string,
	languageId: string,
	sessionMode = positron.LanguageRuntimeSessionMode.Console,
): positron.BaseLanguageRuntimeSession {
	return {
		metadata: { sessionId, sessionMode },
		runtimeMetadata: { languageId },
	} as positron.BaseLanguageRuntimeSession;
}

/** A session variable, as the runtime API reports one. Only the fields this module reads. */
function variable(displayName: string): positron.RuntimeVariable {
	return typed(displayName, 'list');
}

/** A session variable of a given type, which is what a connection is recognized by. */
function typed(displayName: string, displayType: string): positron.RuntimeVariable {
	return { display_name: displayName, display_type: displayType } as positron.RuntimeVariable;
}
