# McpWorkspaceRegistration


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**workspace_id** | **string** | A previously issued workspace ID. Omit to have the server generate one from the display name. | [optional] [default to undefined]
**display_name** | **string** | A human-readable name for the workspace, normally the folder the user has open. Shown in logs and status, and used to build the workspace ID. | [default to undefined]
**preferred_port** | **number** | The TCP port the MCP listener should bind. Used only when the listener isn\&#39;t running yet, and ignored when the port is unavailable. | [optional] [default to undefined]
**capabilities** | [**McpWorkspaceCapabilities**](McpWorkspaceCapabilities.md) |  | [optional] [default to undefined]

## Example

```typescript
import { McpWorkspaceRegistration } from './api';

const instance: McpWorkspaceRegistration = {
    workspace_id,
    display_name,
    preferred_port,
    capabilities,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
