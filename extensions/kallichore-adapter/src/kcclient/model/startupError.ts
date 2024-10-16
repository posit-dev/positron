/**
 * Kallichore API
 * Kallichore is a Jupyter kernel gateway and supervisor
 *
 * The version of the OpenAPI document: 1.0.0
 * Contact: info@posit.co
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { RequestFile } from './models';
import { ModelError } from './modelError';

export class StartupError {
    /**
    * The exit code of the process, if it exited
    */
    'exitCode'?: number;
    /**
    * The output of the process (combined stdout and stderr) emitted during startup, if any
    */
    'output'?: string;
    'error': ModelError;

    static discriminator: string | undefined = undefined;

    static attributeTypeMap: Array<{name: string, baseName: string, type: string}> = [
        {
            "name": "exitCode",
            "baseName": "exit_code",
            "type": "number"
        },
        {
            "name": "output",
            "baseName": "output",
            "type": "string"
        },
        {
            "name": "error",
            "baseName": "error",
            "type": "ModelError"
        }    ];

    static getAttributeTypeMap() {
        return StartupError.attributeTypeMap;
    }
}

