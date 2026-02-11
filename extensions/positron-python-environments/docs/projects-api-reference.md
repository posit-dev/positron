# Python Projects API Reference

## Modifying Projects
This is how the projects API is designed with the different parts of the project flow. Here `getPythonProjects` is used as an example function but behavior will mirror other getter and setter functions exposed in the API.

1. **API Call:** Extensions can calls `getPythonProjects` on [`PythonEnvironmentApi`](../src/api.ts).
2. **API Implementation:** [`PythonEnvironmentApiImpl`](../src/features/pythonApi.ts) delegates to its internal project manager.
3. **Internal API:** The project manager is typed as [`PythonProjectManager`](../src/internal.api.ts).
4. **Concrete Implementation:** [`PythonProjectManagerImpl`](../src/features/projectManager.ts) implements the actual logic.
5. **Data Model:** Returns an array of [`PythonProject`](../src/api.ts) objects.

## Project Creators
This is how creating projects work with the API as it uses a method of registering
external or internal project creators and maintaining project states internally in
just this extension.

- **Project Creators:** Any extension can implement and register a project creator by conforming to the [`PythonProjectCreator`](../src/api.ts) interface. Each creator provides a `create` method that returns one or more new projects (or their URIs). The create method is responsible for add the new projects to the project manager.
- **Registration:** Project creators are registered with the API, making them discoverable and usable by the extension or other consumers.
- **Integration:** Once a project is created, it is added to the internal project manager (`PythonProjectManagerImpl` in [`src/features/projectManager.ts`](../src/features/projectManager.ts)), which updates the set of known projects and persists settings if necessary.

### What an Extension Must Do

1. **Implement the Creator Interface:**
   - Create a class that implements the [`PythonProjectCreator`](../src/api.ts) interface.
   - Provide a unique `name`, a user-friendly `displayName`, and a `create` method that returns one or more `PythonProject` objects or URIs.

2. **Register the Creator:**
   - Register the creator with the main API (usually via a registration method exposed by this extension’s API surface).
   - This makes the creator discoverable and usable by the extension and other consumers.

3. **Add Projects Directly:**
   - If your creator directly creates `PythonProject` objects, you MUST call the internal project manager’s `add` method during your create function to add projects as ones in the workspace.


### Responsibilities Table

| Step                                       | External Extension’s Responsibility | Internal Python-Envs-Ext Responsibility |
| ------------------------------------------ | :---------------------------------: | :-------------------------------------: |
| Implement `PythonProjectCreator` interface |                  ☑️                  |                                         |
| Register the creator                       |                  ☑️                  |                                         |
| Provide `create` method                    |                  ☑️                  |                                         |
| Add projects to project manager            |                  ☑️                  |                                         |
| Update project settings                    |                                     |                    ☑️                    |
| Track and list creators                    |                                     |                    ☑️                    |
| Invoke creator and handle results          |                                     |                    ☑️                    |


### Example Implementation: [`ExistingProjects`](../src/features/creators/existingProjects.ts)

The [`ExistingProjects`](../src/features/creators/existingProjects.ts) class is an example of a project creator. It allows users to select files or folders from the workspace and creates new `PythonProject` instances for them. After creation, these projects are added to the internal project manager:

create function implementation abbreviated:
```typescript
async create(
        _options?: PythonProjectCreatorOptions,
    ): Promise<PythonProject | PythonProject[] | Uri | Uri[] | undefined> {
const projects = resultsInWorkspace.map(
                (uri) => new PythonProjectsImpl(path.basename(uri.fsPath), uri),
            ) as PythonProject[];
this.pm.add(projects);
return projects;
    }
```

creator registration (usually on extension activation):
```
  projectCreators.registerPythonProjectCreator(new ExistingProjects(projectManager)),

```

- **Implements:** [`PythonProjectCreator`](../src/api.ts)
- **Adds projects to:** `PythonProjectManager` (see below)



