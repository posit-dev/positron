/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { VariablesClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeVariablesClient.js';
import { PositronVariablesComm, Variable, VariableList } from '../../../../services/languageRuntime/common/positronVariablesComm.js';
import { IPositronVariablesInstance } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { resolveSessionId, resolveVariableNamesToAccessKeys } from '../../browser/tools/positronAssistantToolUtils.js';

const SESSION_ID = 'test-session';

/** Build a minimal Variable exposing only the fields the helpers read. */
function variable(displayName: string, accessKey: string): Variable {
	return stubInterface<Variable>({ display_name: displayName, access_key: accessKey });
}

/** Build a variables service whose single session lists the given root variables. */
function variablesServiceWith(rootVariables: Variable[]): IPositronVariablesService {
	const comm = stubInterface<PositronVariablesComm>({
		list: async () => stubInterface<VariableList>({ variables: rootVariables, length: rootVariables.length }),
	});
	const client = stubInterface<VariablesClientInstance>({ comm });
	const instance = stubInterface<IPositronVariablesInstance>({
		session: stubInterface<ILanguageRuntimeSession>({ sessionId: SESSION_ID }),
		getClientInstance: () => client,
	});
	return stubInterface<IPositronVariablesService>({ positronVariablesInstances: [instance] });
}

describe('resolveSessionId', () => {
	function runtimeSessionServiceWith(foregroundSessionId?: string): IRuntimeSessionService {
		return stubInterface<IRuntimeSessionService>({
			foregroundSession: foregroundSessionId
				? stubInterface<ILanguageRuntimeSession>({ sessionId: foregroundSessionId })
				: undefined,
		});
	}

	it('uses the supplied identifier when present', () => {
		expect(resolveSessionId(runtimeSessionServiceWith('fg'), 'explicit')).toBe('explicit');
	});

	it('falls back to the foreground session for a missing or "undefined" identifier', () => {
		const service = runtimeSessionServiceWith('fg');
		expect(resolveSessionId(service, undefined)).toBe('fg');
		expect(resolveSessionId(service, 'undefined')).toBe('fg');
	});

	it('returns undefined when there is no foreground session', () => {
		expect(resolveSessionId(runtimeSessionServiceWith(undefined))).toBeUndefined();
	});
});

describe('resolveVariableNamesToAccessKeys', () => {
	it('resolves each requested name to its access key when all are found', async () => {
		const service = variablesServiceWith([variable('df', 'key_df'), variable('x', 'key_x')]);

		const result = await resolveVariableNamesToAccessKeys(service, SESSION_ID, ['df', 'x']);

		expect(result).toEqual({
			accessKeys: [['key_df'], ['key_x']],
			allFound: true,
			notFound: [],
		});
	});

	it('returns all variables and the not-found names when any name is missing', async () => {
		const service = variablesServiceWith([variable('exists', 'key_exists')]);

		const result = await resolveVariableNamesToAccessKeys(service, SESSION_ID, ['exists', 'missing']);

		expect(result).toEqual({
			accessKeys: [['key_exists']],
			allFound: false,
			notFound: ['missing'],
		});
	});

	it('reports every root variable as available for an empty session', async () => {
		const service = variablesServiceWith([]);

		const result = await resolveVariableNamesToAccessKeys(service, SESSION_ID, ['anything']);

		expect(result).toEqual({
			accessKeys: [],
			allFound: false,
			notFound: ['anything'],
		});
	});
});
