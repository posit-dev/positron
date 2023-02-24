//
// version.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::process::Command;
use itertools::Itertools;

use anyhow::Context;

#[allow(dead_code)]
pub struct RVersion {
    // Major version of the R installation
    major: u32,

    // Minor version of the R installation
    minor: u32,

    // Patch version of the R installation
    patch: u32,

    // The full path on disk to the R installation -- that is, the value R_HOME
    // would have inside an R session: > R.home()
    pub r_home: String,
}

pub fn detect_r() -> anyhow::Result<RVersion> {

    let output = Command::new("R")
        .arg("RHOME")
        .output()
        .context("Failed to execute R to determine R_HOME")?;

    // Convert the output to a string
    let r_home = String::from_utf8(output.stdout)
        .context("Failed to convert R_HOME output to string")?
        .trim()
        .to_string();

    let output = Command::new("R")
        .arg("--vanilla")
        .arg("-s")
        .arg("-e")
        .arg("cat(version$major, \".\", version$minor, sep = \"\")")
        .output()
        .context("Failed to execute R to determine version number")?;

    let version = String::from_utf8(output.stdout)
        .context("Failed to convert R version number to a string")?
        .trim()
        .to_string();

    let version = version.split(".")
        .map(|x| {
            x.parse::<u32>()
        });

    if let Some((Ok(major), Ok(minor), Ok(patch))) = version.collect_tuple() {
        Ok(RVersion{
            major,
            minor,
            patch,
            r_home
        })
    } else {
        anyhow::bail!("Failed to extract R version");
    }

}

#[test]
fn test_detect_r() {
    let version = detect_r().unwrap();
    println!("{}.{}.{}", version.major, version.minor, version.patch);
}
