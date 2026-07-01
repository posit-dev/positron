/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as sinon from 'sinon';
import { URI } from '../../../../base/common/uri.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions, IConfigurationRegistry, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { MainThreadConfiguration } from '../../browser/mainThreadConfiguration.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { WorkspaceService } from '../../../services/configuration/browser/configurationService.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
// --- Start Positron ---
import { ILogService, NullLogService } from '../../../../platform/log/common/log.js';
import { Extensions as ConfigurationMigrationExtensions, IConfigurationMigrationRegistry } from '../../../common/configuration.js';
// --- End Positron ---

suite('MainThreadConfiguration', function () {

	ensureNoDisposablesAreLeakedInTestSuite();

	const proxy = {
		$initializeConfiguration: () => { }
	};
	let instantiationService: TestInstantiationService;
	let target: sinon.SinonSpy;

	suiteSetup(() => {
		Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
			'id': 'extHostConfiguration',
			'title': 'a',
			'type': 'object',
			'properties': {
				'extHostConfiguration.resource': {
					'description': 'extHostConfiguration.resource',
					'type': 'boolean',
					'default': true,
					'scope': ConfigurationScope.RESOURCE
				},
				'extHostConfiguration.window': {
					'description': 'extHostConfiguration.resource',
					'type': 'boolean',
					'default': true,
					'scope': ConfigurationScope.WINDOW
				}
			}
		});
	});

	setup(() => {
		target = sinon.spy();

		instantiationService = new TestInstantiationService();
		instantiationService.stub(IConfigurationService, WorkspaceService);
		instantiationService.stub(IConfigurationService, 'onDidUpdateConfiguration', sinon.mock());
		instantiationService.stub(IConfigurationService, 'onDidChangeConfiguration', sinon.mock());
		instantiationService.stub(IConfigurationService, 'updateValue', target);
		instantiationService.stub(IEnvironmentService, {
			isBuilt: false
		});
		// --- Start Positron ---
		instantiationService.stub(ILogService, new NullLogService());
		// --- End Positron ---
	});

	teardown(() => {
		instantiationService.dispose();
	});

	test('update resource configuration without configuration target defaults to workspace in multi root workspace when no resource is provided', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.WORKSPACE });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$updateConfigurationOption(null, 'extHostConfiguration.resource', 'value', undefined, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('update resource configuration without configuration target defaults to workspace in folder workspace when resource is provider', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$updateConfigurationOption(null, 'extHostConfiguration.resource', 'value', { resource: URI.file('abc') }, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('update resource configuration without configuration target defaults to workspace in folder workspace when no resource is provider', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$updateConfigurationOption(null, 'extHostConfiguration.resource', 'value', undefined, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('update window configuration without configuration target defaults to workspace in multi root workspace when no resource is provided', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.WORKSPACE });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$updateConfigurationOption(null, 'extHostConfiguration.window', 'value', undefined, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('update window configuration without configuration target defaults to workspace in multi root workspace when resource is provided', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.WORKSPACE });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$updateConfigurationOption(null, 'extHostConfiguration.window', 'value', { resource: URI.file('abc') }, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('update window configuration without configuration target defaults to workspace in folder workspace when resource is provider', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$updateConfigurationOption(null, 'extHostConfiguration.window', 'value', { resource: URI.file('abc') }, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('update window configuration without configuration target defaults to workspace in folder workspace when no resource is provider', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$updateConfigurationOption(null, 'extHostConfiguration.window', 'value', undefined, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('update resource configuration without configuration target defaults to folder', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.WORKSPACE });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$updateConfigurationOption(null, 'extHostConfiguration.resource', 'value', { resource: URI.file('abc') }, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE_FOLDER, target.args[0][3]);
	});

	test('update configuration with user configuration target', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$updateConfigurationOption(ConfigurationTarget.USER, 'extHostConfiguration.window', 'value', { resource: URI.file('abc') }, undefined);

		assert.strictEqual(ConfigurationTarget.USER, target.args[0][3]);
	});

	test('update configuration with workspace configuration target', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$updateConfigurationOption(ConfigurationTarget.WORKSPACE, 'extHostConfiguration.window', 'value', { resource: URI.file('abc') }, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('update configuration with folder configuration target', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$updateConfigurationOption(ConfigurationTarget.WORKSPACE_FOLDER, 'extHostConfiguration.window', 'value', { resource: URI.file('abc') }, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE_FOLDER, target.args[0][3]);
	});

	test('remove resource configuration without configuration target defaults to workspace in multi root workspace when no resource is provided', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.WORKSPACE });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$removeConfigurationOption(null, 'extHostConfiguration.resource', undefined, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('remove resource configuration without configuration target defaults to workspace in folder workspace when resource is provider', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$removeConfigurationOption(null, 'extHostConfiguration.resource', { resource: URI.file('abc') }, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('remove resource configuration without configuration target defaults to workspace in folder workspace when no resource is provider', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$removeConfigurationOption(null, 'extHostConfiguration.resource', undefined, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('remove window configuration without configuration target defaults to workspace in multi root workspace when no resource is provided', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.WORKSPACE });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$removeConfigurationOption(null, 'extHostConfiguration.window', undefined, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('remove window configuration without configuration target defaults to workspace in multi root workspace when resource is provided', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.WORKSPACE });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$removeConfigurationOption(null, 'extHostConfiguration.window', { resource: URI.file('abc') }, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('remove window configuration without configuration target defaults to workspace in folder workspace when resource is provider', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$removeConfigurationOption(null, 'extHostConfiguration.window', { resource: URI.file('abc') }, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('remove window configuration without configuration target defaults to workspace in folder workspace when no resource is provider', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$removeConfigurationOption(null, 'extHostConfiguration.window', undefined, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE, target.args[0][3]);
	});

	test('remove configuration without configuration target defaults to folder', function () {
		instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.WORKSPACE });
		const testObject: MainThreadConfiguration = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

		testObject.$removeConfigurationOption(null, 'extHostConfiguration.resource', { resource: URI.file('abc') }, undefined);

		assert.strictEqual(ConfigurationTarget.WORKSPACE_FOLDER, target.args[0][3]);
	});

	// --- Start Positron ---
	suite('registerConfigurationMigrations', function () {

		const OWNED_KEY = 'extHostConfigMigration.oldKey';
		const OWNER_EXT = 'test.owner';

		suiteSetup(() => {
			Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
				id: 'extHostConfigMigration',
				type: 'object',
				extensionInfo: { id: OWNER_EXT },
				properties: {
					[OWNED_KEY]: { type: 'boolean', description: 'test key for migration tests' }
				}
			});
		});

		let migrationRegistry: IConfigurationMigrationRegistry;
		let registerSpy: sinon.SinonSpy;
		let warnSpy: sinon.SinonSpy;

		setup(() => {
			migrationRegistry = Registry.as<IConfigurationMigrationRegistry>(ConfigurationMigrationExtensions.ConfigurationMigration);
			registerSpy = sinon.spy(migrationRegistry, 'registerConfigurationMigrations');
			const logService = new NullLogService();
			warnSpy = sinon.spy(logService, 'warn');
			instantiationService.stub(ILogService, logService);
			instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{ getWorkbenchState: () => WorkbenchState.FOLDER });
		});

		teardown(() => {
			registerSpy.restore();
		});

		test('owned key is accepted and migrateFn maps value correctly', function () {
			const testObject = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

			testObject.$registerConfigurationMigrations(OWNER_EXT, [{ key: OWNED_KEY, migrateTo: 'extHostConfigMigration.newKey' }]);

			assert.ok(registerSpy.calledOnce, 'registerConfigurationMigrations should be called once');
			const [migrations] = registerSpy.args[0] as [Array<{ key: string; migrateFn: (v: unknown) => unknown }>];
			assert.strictEqual(migrations.length, 1);
			assert.strictEqual(migrations[0].key, OWNED_KEY);
			const result = migrations[0].migrateFn('testValue');
			assert.deepStrictEqual(result, [
				['extHostConfigMigration.newKey', { value: 'testValue' }],
				[OWNED_KEY, { value: undefined }],
			]);
		});

		test('unowned key is rejected and a warning is logged', function () {
			const testObject = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

			testObject.$registerConfigurationMigrations('other.extension', [{ key: OWNED_KEY, migrateTo: 'extHostConfigMigration.newKey' }]);

			assert.ok(warnSpy.calledOnce, 'warn should be called for unowned key');
			assert.ok(registerSpy.notCalled, 'registerConfigurationMigrations should not be called');
		});

		test('posit publisher bypasses ownership check', function () {
			const testObject = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));

			testObject.$registerConfigurationMigrations('posit.extension', [{ key: OWNED_KEY, migrateTo: 'extHostConfigMigration.newKey' }]);

			assert.ok(registerSpy.calledOnce, 'posit publisher should be able to migrate unowned key');
			assert.ok(warnSpy.notCalled, 'no warning should be logged for posit publisher');
		});

		test('unregistered key is accepted when it matches extension namespace', function () {
			const testObject = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));
			const droppedKey = `${OWNER_EXT}.droppedKey`; // never registered; simulates rename-and-remove

			testObject.$registerConfigurationMigrations(OWNER_EXT, [{ key: droppedKey, migrateTo: 'extHostConfigMigration.newKey' }]);

			assert.ok(registerSpy.calledOnce, 'migration for unregistered key in extension namespace should be accepted');
			assert.ok(warnSpy.notCalled, 'no warning should be logged for namespace-owned key');
		});

		test('unregistered key outside extension namespace is rejected', function () {
			const testObject = instantiationService.createInstance(MainThreadConfiguration, SingleProxyRPCProtocol(proxy));
			const foreignKey = 'other.publisher.droppedKey'; // unregistered and wrong namespace

			testObject.$registerConfigurationMigrations(OWNER_EXT, [{ key: foreignKey, migrateTo: 'extHostConfigMigration.newKey' }]);

			assert.ok(warnSpy.calledOnce, 'warn should be called for unregistered key outside extension namespace');
			assert.ok(registerSpy.notCalled, 'migration should not be registered');
		});
	});
	// --- End Positron ---
});
