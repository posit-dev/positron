//
// url.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use anyhow::*;
use stdext::unwrap;
use std::path::PathBuf;
use std::result::Result::Ok;
use tower_lsp::lsp_types::Url;

pub trait UrlExt {
    fn file_path(&self) -> anyhow::Result<PathBuf>;
}

impl UrlExt for Url {

    fn file_path(&self) -> anyhow::Result<PathBuf> {

        let pathbuf = unwrap!(self.to_file_path(), Err(_) => {
            return Err(anyhow!("error converting URI {} to PathBuf", self));
        });

        Ok(pathbuf)

    }
}
