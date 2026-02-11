import { getDefaultEnvManagerSetting, getDefaultPkgManagerSetting } from '../../features/settings/settingHelpers';
import { PythonProjectManager } from '../../internal.api';
import { EventNames } from './constants';
import { sendTelemetryEvent } from './sender';

export function sendManagerSelectionTelemetry(pm: PythonProjectManager) {
    const ems: Set<string> = new Set();
    const ps: Set<string> = new Set();
    pm.getProjects().forEach((project) => {
        const m = getDefaultEnvManagerSetting(pm, project.uri);
        if (m) {
            ems.add(m);
        }

        const p = getDefaultPkgManagerSetting(pm, project.uri);
        if (p) {
            ps.add(p);
        }
    });

    ems.forEach((em) => {
        sendTelemetryEvent(EventNames.ENVIRONMENT_MANAGER_SELECTED, undefined, { managerId: em });
    });

    ps.forEach((pkg) => {
        sendTelemetryEvent(EventNames.PACKAGE_MANAGER_SELECTED, undefined, { managerId: pkg });
    });
}
