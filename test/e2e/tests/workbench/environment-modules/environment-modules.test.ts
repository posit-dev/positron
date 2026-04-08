/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Environment Modules', { tag: [tags.WORKBENCH, tags.ENVIRONMENT_MODULES] }, () => {

	/**
	 * Configure bashrc for environment modules if not already done
	 */
	async function configureBashrcForModules(runDockerCommand: (command: string, description: string) => Promise<any>): Promise<void> {
		// Check if modules.sh is already sourced in .bashrc
		const { stdout } = await runDockerCommand(
			'docker exec test bash -c "grep -q \\"source /etc/profile.d/modules.sh\\" /home/user1/.bashrc && echo \\"configured\\" || echo \\"not-configured\\""',
			'Check if modules are configured in .bashrc'
		);

		if (stdout.trim() === 'not-configured') {
			await runDockerCommand(
				'docker exec test bash -c "echo \'source /etc/profile.d/modules.sh\' >> /home/user1/.bashrc"',
				'Add modules.sh to .bashrc'
			);
			await runDockerCommand(
				'docker exec test bash -c "echo \'module use /opt/modules/modulefiles\' >> /home/user1/.bashrc"',
				'Add module use to .bashrc'
			);
		}
	}

	test('Python - Create module environment', async function ({ app, runDockerCommand, sessions }) {
		await app.workbench.quickaccess.createModuleEnvironment(
			'Python 3.12.10 Module',
			['python'],
			['python/3.12.10']
		);

		// Verify the module environment was created with the correct category
		await expect(async () => {
			const runtimes = await app.workbench.sessions.getAllAvailableRuntimes();
			const pythonModule = runtimes.find(r => r.name.includes('Python 3.12.10') && r.category.includes('Module'));
			expect(pythonModule).toBeDefined();
		}).toPass({ timeout: 30000 });

		await configureBashrcForModules(runDockerCommand);

		await sessions.start('pythonHidden');

		await app.workbench.console.waitForConsoleContents('Module');
	});

	test('R - Create module environment', async function ({ app, runDockerCommand, sessions }) {
		await app.workbench.quickaccess.createModuleEnvironment(
			'R 4.4.1 Module',
			['r'],
			['R/4.4.1']
		);

		// Verify the module environment was created with the correct category
		await expect(async () => {
			const runtimes = await app.workbench.sessions.getAllAvailableRuntimes();
			const rModule = runtimes.find(r => r.name.includes('R 4.4.1') && r.category.includes('Module'));
			expect(rModule).toBeDefined();
		}).toPass({ timeout: 30000 });

		await configureBashrcForModules(runDockerCommand);

		await sessions.start('rHidden');

		await app.workbench.console.waitForConsoleContents('Module');
	});

});
