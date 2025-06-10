In RStudio, you organize your work using **projects**. Positron doesn't have projects per se, but the concept in Positron that is most analogous to an RStudio project is a **workspace**. You can read more in the VS Code documentation about [what exactly a workspace is](https://code.visualstudio.com/docs/editor/workspaces), but in general think of a workspace as about the same thing as a folder, which is about the same thing as a project in RStudio.

- If you have an existing local folder (including an RStudio project folder) that you want to work in, you can _open_ it in Positron.
- If you have an existing GitHub repository that you want to work with, you can _create_ a new local folder using ["Workspaces: New Folder from Git..."](command:positron.workbench.action.newFolderFromGit).
- If you are starting something entirely new, you can _create_ a new folder using ["Workspaces: New Folder from Template..."](command:positron.workbench.action.newFolderFromTemplate).

One difference is that in Positron, there is no special file that designates your folder as a workspace; there is no equivalent to an `.Rproj` file. Read more in our documentation about [how to think about Positron workspaces when you are accustomed to RStudio projects using `.Rproj` files](https://positron.posit.co/rstudio-rproj-file.html).

Another difference is that in Positron, your R process always starts with a "blank slate"; Positron does not provide support for saving and loading your workspace state such as via an `.Rdata` file.
