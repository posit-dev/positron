# ConnectionInfo

Connection information for an existing session

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**control_port** | **number** | The port for control messages | [default to undefined]
**shell_port** | **number** | The port for shell messages | [default to undefined]
**stdin_port** | **number** | The port for stdin messages | [default to undefined]
**hb_port** | **number** | The port for heartbeat messages | [default to undefined]
**iopub_port** | **number** | The port for IOPub messages | [default to undefined]
**signature_scheme** | **string** | The signature scheme for messages | [default to undefined]
**key** | **string** | The key for messages | [default to undefined]
**transport** | **string** | The transport protocol | [default to undefined]
**ip** | **string** | The IP address for the connection | [default to undefined]

## Example

```typescript
import { ConnectionInfo } from './api';

const instance: ConnectionInfo = {
    control_port,
    shell_port,
    stdin_port,
    hb_port,
    iopub_port,
    signature_scheme,
    key,
    transport,
    ip,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
