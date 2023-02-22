//
// modules.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use libR_sys::*;
use log::*;
use std::env;
use std::path::Path;
use walkdir::WalkDir;

pub struct RModuleInfo {
    pub help_server_port: i32,
}

pub unsafe fn initialize() -> anyhow::Result<RModuleInfo> {

    // Ensure the 'tools:rstudio' environment has been initialized.
    let envir = RFunction::new("base", "attach")
        .param("what", R_NilValue)
        .param("name", "tools:rstudio")
        .call()?;

    // Get the path to the 'modules' directory, adjacent to the executable file.
    // This is where we place the R source files in packaged releases.
    let mut root = match env::current_exe() {
        Ok(exe_path) => exe_path.parent().unwrap().join("modules"),
        Err(error) => {
            warn!("Failed to get current exe path; can't find R modules");
            return Err(error.into());
        }
    };

    // If that path doesn't exist, we're probably running from source, so
    // look in the source tree (found via the 'CARGO_MANIFEST_DIR' environment
    // variable).
    if !root.exists() {
        let source = format!("{}/src/lsp/modules", env!("CARGO_MANIFEST_DIR"));
        root = Path::new(&source).to_path_buf();
    }

    // Import all module files.
    // TODO: Need to select appropriate path for package builds.
    info!("Loading modules from directory: {}", root.display());
    for file in WalkDir::new(root).into_iter().filter_map(|file| file.ok()) {
        let path = file.path();
        if let Some(ext) = path.extension() {
            if ext == "R" {
                info!("Loading module: {:?}", path);
                import(path.to_str().unwrap(), *envir);
            }
        }
    }

    // Get the help server port.
    let help_server_port = RFunction::new("tools", "httpdPort")
        .call()?
        .to::<i32>()?;

    return Ok(RModuleInfo {
        help_server_port: help_server_port,
    });
}

pub unsafe fn import(file: &str, envir: SEXP) {
    RFunction::new("base", "sys.source")
        .param("file", file)
        .param("envir", envir)
        .call()
        .unwrap();
}
