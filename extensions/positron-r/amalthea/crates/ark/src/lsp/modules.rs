//
// modules.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use libR_sys::*;
use log::*;
use walkdir::WalkDir;


pub unsafe fn initialize() {

    // Ensure the 'tools:rstudio' environment has been initialized.
    let envir = RFunction::new("base", "attach")
        .param("what", R_NilValue)
        .param("name", "tools:rstudio")
        .call()
        .unwrap();

    // Import all module files.
    // TODO: Need to select appropriate path for package builds.
    let root = format!("{}/src/lsp/modules", env!("CARGO_MANIFEST_DIR"));
    info!("Loading modules from directory: {}", root);
    for file in WalkDir::new(root).into_iter().filter_map(|file| file.ok()) {
        let path = file.path();
        if let Some(ext) = path.extension() {
            if ext == "R" {
                info!("Loading module: {:?}", path);
                import(path.to_str().unwrap(), *envir);
            }
        }
    }

}

pub unsafe fn import(file: &str, envir: SEXP) {

    RFunction::new("base", "sys.source")
        .param("file", file)
        .param("envir", envir)
        .call()
        .unwrap();

}
