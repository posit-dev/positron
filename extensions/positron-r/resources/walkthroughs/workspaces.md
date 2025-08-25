In RStudio, you organize your work using **Projects** that are identified by an `.Rproj` file. Positron doesn't have an exact equivalent to RStudio Projects, but the concept in Positron that is most analogous to an RStudio Project is a **workspace**. You can read more in the VS Code documentation about [what exactly a workspace is](https://code.visualstudio.com/docs/editor/workspaces), but in general think of a workspace as about the same thing as a folder, which is about the same thing as an RStudio Project.

- If you have an existing local folder (including an RStudio project folder) that you want to work in, you can _open_ it in Positron.
- If you have an existing GitHub repository that you want to work with, you can _create_ a new local folder using ["Workspaces: New Folder from Git..."](command:positron.workbench.action.newFolderFromGit).
- If you are starting something entirely new, you can _create_ a new folder using ["Workspaces: New Folder from Template..."](command:positron.workbench.action.newFolderFromTemplate).

One difference is that in Positron, there is no required special file that designates your folder as a workspace; there is no direct equivalent to an `.Rproj` file. Read more in our documentation about [how to think about Positron workspaces when you are accustomed to RStudio Projects using `.Rproj` files](https://positron.posit.co/migrate-rstudio-rproj.html), and [how to use `settings.json` files for workspace configuration](https://positron.posit.co/rstudio-rproj-file.html#positron-workspaces-and-settings.json).

Another difference is that in Positron, your R process always starts with a "blank slate"; Positron does not provide support for saving your workspace state (to be loaded later in a new session) such as via an `.Rdata` file.
