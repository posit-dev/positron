# ---------------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

# Package management functions for Positron.
# These functions are sourced by the positron-r extension and called from TypeScript.
# Function names use a .ps.packages prefix to namespace them and hide from ls() output.

# Convert a data frame to a list of row objects for JSON serialization.
# .ps.to_json() serializes data frames as column-major, but we need row-major
# (array of objects) for the TypeScript consumer.
.ps.packages.df_to_rows <- function(df) {
	lapply(seq_len(nrow(df)), function(i) as.list(df[i, , drop = FALSE]))
}

.ps.packages.list_packages <- function(method = c("pak", "base")) {
	method <- match.arg(method)
	switch(
		method,
		pak = {
			old_opt <- options(pak.no_extra_messages = TRUE)
			on.exit(options(old_opt), add = TRUE)
			pkgs <- pak::lib_status()
			df <- data.frame(
				id = paste0(pkgs$package, "-", pkgs$version),
				name = pkgs$package,
				displayName = pkgs$package,
				version = as.character(pkgs$version)
			)
			cat(.ps.to_json(.ps.packages.df_to_rows(df)))
		},
		base = {
			ip <- installed.packages()
			df <- data.frame(
				id = paste0(ip[, "Package"], "-", ip[, "Version"]),
				name = ip[, "Package"],
				displayName = ip[, "Package"],
				version = ip[, "Version"]
			)
			cat(.ps.to_json(.ps.packages.df_to_rows(df)))
		}
	)
}

.ps.packages.install_packages <- function(packages, method = c("pak", "base")) {
	method <- match.arg(method)
	switch(
		method,
		pak = pak::pkg_install(packages, ask = FALSE),
		base = install.packages(packages)
	)
}

.ps.packages.update_all_packages <- function(method = c("pak", "base")) {
	method <- match.arg(method)
	switch(
		method,
		pak = {
			old_opt <- options(pak.no_extra_messages = TRUE)
			on.exit(options(old_opt), add = TRUE)
			outdated <- old.packages()[, "Package"]
			if (length(outdated) > 0) {
				pak::pkg_install(outdated, ask = FALSE)
			}
		},
		base = update.packages(ask = FALSE)
	)
}

.ps.packages.uninstall_packages <- function(packages, method = c("pak", "base")) {
	method <- match.arg(method)
	switch(
		method,
		pak = pak::pkg_remove(packages),
		base = remove.packages(packages)
	)
	for (pkg in packages) {
		try(unloadNamespace(pkg), silent = TRUE)
	}
}

.ps.packages.search_packages <- function(query, method = c("pak", "base")) {
	method <- match.arg(method)
	switch(
		method,
		pak = {
			old_opt <- options(pak.no_extra_messages = TRUE)
			on.exit(options(old_opt), add = TRUE)
			pkgs <- pak::pkg_search(query, size = 100)
			df <- data.frame(
				id = pkgs$package,
				name = pkgs$package,
				displayName = pkgs$package,
				version = "0"
			)
			cat(.ps.to_json(.ps.packages.df_to_rows(df)))
		},
		base = {
			query <- tolower(query)
			ap <- available.packages()
			matches <- ap[
				grepl(query, tolower(ap[, "Package"]), fixed = TRUE),
				,
				drop = FALSE
			]
			df <- data.frame(
				id = matches[, "Package"],
				name = matches[, "Package"],
				displayName = matches[, "Package"],
				version = "0"
			)
			cat(.ps.to_json(.ps.packages.df_to_rows(df)))
		}
	)
}

.ps.packages.search_package_versions <- function(name) {
	ap <- available.packages()
	current <- if (name %in% rownames(ap)) ap[name, "Version"] else character(0)
	# Wrap in as.list() to ensure it serializes as an array, not a scalar
	cat(.ps.to_json(as.list(current)))
}
