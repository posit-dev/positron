//
// modules.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use libR_sys::*;
use walkdir::WalkDir;

use crate::r::exec::RFunction;
use crate::r::exec::RFunctionExt;
use crate::r::exec::RProtect;

pub(crate) unsafe fn initialize() {

    // Ensure the 'tools:rstudio' environment has been initialized.
    let mut protect = RProtect::new();
    let envir = RFunction::new("base", "attach")
        .param("what", R_NilValue)
        .param("name", "tools:rstudio")
        .call(&mut protect);

    // Import all module files.
    // TODO: Need to select appropriate path for package builds.
    let root = format!("{}/src/r/modules", env!("CARGO_MANIFEST_DIR"));
    for file in WalkDir::new(root).into_iter().filter_map(|file| file.ok()) {
        let path = file.path();
        if let Some(ext) = path.extension() {
            if ext == "R" {
                import(path.to_str().unwrap(), envir);
            }
        }
    }

}

pub(crate) unsafe fn import(file: &str, envir: SEXP) {

    let mut protect = RProtect::new();
    RFunction::new("base", "sys.source")
        .param("file", file)
        .param("envir", envir)
        .call(&mut protect);

}
