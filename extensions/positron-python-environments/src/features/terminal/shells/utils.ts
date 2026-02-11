import * as cp from 'child_process';
import { traceError, traceInfo } from '../../../common/logging';
import { StopWatch } from '../../../common/stopWatch';

export async function runCommand(command: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        const timer = new StopWatch();
        cp.exec(command, (err, stdout) => {
            if (err) {
                traceError(`Error running command: ${command} (${timer.elapsedTime})`, err);
                resolve(undefined);
            } else {
                traceInfo(`Ran ${command} in ${timer.elapsedTime}`);
                resolve(stdout?.trim());
            }
        });
    });
}
