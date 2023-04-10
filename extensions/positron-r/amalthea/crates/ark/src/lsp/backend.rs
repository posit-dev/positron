//
// backend.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

#![allow(deprecated)]

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use amalthea::comm::event::CommEvent;
use crossbeam::channel::Sender;
use dashmap::DashMap;
use harp::r_lock;
use log::*;
use parking_lot::Mutex;
use regex::Regex;
use serde_json::Value;
use stdext::*;
use tokio::net::TcpListener;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::request::GotoImplementationParams;
use tower_lsp::lsp_types::request::GotoImplementationResponse;
use tower_lsp::lsp_types::*;
use tower_lsp::Client;
use tower_lsp::LanguageServer;
use tower_lsp::LspService;
use tower_lsp::Server;

use crate::lsp::completions::append_document_completions;
use crate::lsp::completions::append_session_completions;
use crate::lsp::completions::append_workspace_completions;
use crate::lsp::completions::can_provide_completions;
use crate::lsp::completions::completion_context;
use crate::lsp::completions::resolve_completion_item;
use crate::lsp::completions::CompletionData;
use crate::lsp::definitions::goto_definition;
use crate::lsp::diagnostics;
use crate::lsp::documents::Document;
use crate::lsp::documents::DOCUMENT_INDEX;
use crate::lsp::globals;
use crate::lsp::help_proxy;
use crate::lsp::hover::hover;
use crate::lsp::indexer;
use crate::lsp::modules;
use crate::lsp::signature_help::signature_help;
use crate::lsp::symbols;
use crate::request::Request;

macro_rules! backend_trace {

    ($self: expr, $($rest: expr),*) => {{
        let message = format!($($rest, )*);
        $self.client.log_message(tower_lsp::lsp_types::MessageType::INFO, message).await
    }};

}

#[derive(Debug)]
pub struct Workspace {
    pub folders: Vec<Url>,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            folders: Default::default(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Backend {
    pub client: Client,
    pub documents: Arc<DashMap<Url, Document>>,
    pub workspace: Arc<Mutex<Workspace>>,
    #[allow(dead_code)]
    pub shell_request_tx: Sender<Request>,
    pub lsp_initialized: bool,
}

impl Backend {
    pub fn with_document<T, F>(&self, path: &Path, mut callback: F) -> anyhow::Result<T>
    where
        F: FnMut(&Document) -> anyhow::Result<T>,
    {
        let mut fallback = || {
            let contents = std::fs::read_to_string(path)?;
            let document = Document::new(contents.as_str());
            return callback(&document);
        };

        // If we have a cached copy of the document (because we're monitoring it)
        // then use that; otherwise, try to read the document from the provided
        // path and use that instead.
        let uri = unwrap!(Url::from_file_path(path), Err(_) => {
            info!("couldn't construct uri from {}; reading from disk instead", path.display());
            return fallback();
        });

        let document = unwrap!(self.documents.get(&uri), None => {
            info!("no document for uri {}; reading from disk instead", uri);
            return fallback();
        });

        return callback(document.value());
    }
}

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, params: InitializeParams) -> Result<InitializeResult> {
        backend_trace!(self, "initialize({:#?})", params);

        // Initialize our support functions if this is the first run of the LSP
        // server. A Positron front-end reload will trigger a new LSP server
        // instance to be created, but we only want to run this initialization once per R
        // session.
        if !self.lsp_initialized {
            let r_module_info = r_lock! {
                modules::initialize().unwrap()
            };
            // start R help server proxy
            help_proxy::start(r_module_info.help_server_port);
        }

        // initialize the set of known workspaces
        let mut workspace = self.workspace.lock();

        // initialize the workspace folders
        let mut folders: Vec<String> = Vec::new();
        if let Some(workspace_folders) = params.workspace_folders {
            for folder in workspace_folders.iter() {
                workspace.folders.push(folder.uri.clone());
                if let Ok(path) = folder.uri.to_file_path() {
                    if let Some(path) = path.to_str() {
                        folders.push(path.to_string());
                    }
                }
            }
        }

        // start indexing
        indexer::start(folders);

        Ok(InitializeResult {
            server_info: Some(ServerInfo {
                name: "Amalthea R Kernel (ARK)".to_string(),
                version: Some(env!("CARGO_PKG_VERSION").to_string()),
            }),
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::INCREMENTAL,
                )),
                selection_range_provider: None,
                hover_provider: Some(HoverProviderCapability::from(true)),
                completion_provider: Some(CompletionOptions {
                    resolve_provider: Some(true),
                    trigger_characters: Some(vec![
                        "$".to_string(),
                        "@".to_string(),
                        ":".to_string(),
                    ]),
                    work_done_progress_options: Default::default(),
                    all_commit_characters: None,
                    ..Default::default()
                }),
                signature_help_provider: Some(SignatureHelpOptions {
                    trigger_characters: Some(vec![
                        "(".to_string(),
                        ",".to_string(),
                        "=".to_string(),
                    ]),
                    retrigger_characters: None,
                    work_done_progress_options: WorkDoneProgressOptions {
                        work_done_progress: None,
                    },
                }),
                definition_provider: Some(OneOf::Left(true)),
                type_definition_provider: None,
                implementation_provider: Some(ImplementationProviderCapability::Simple(true)),
                references_provider: Some(OneOf::Left(true)),
                document_symbol_provider: Some(OneOf::Left(true)),
                workspace_symbol_provider: Some(OneOf::Left(true)),
                execute_command_provider: Some(ExecuteCommandOptions {
                    commands: vec!["dummy.do_something".to_string()],
                    work_done_progress_options: Default::default(),
                }),
                workspace: Some(WorkspaceServerCapabilities {
                    workspace_folders: Some(WorkspaceFoldersServerCapabilities {
                        supported: Some(true),
                        change_notifications: Some(OneOf::Left(true)),
                    }),
                    file_operations: None,
                }),
                ..ServerCapabilities::default()
            },
        })
    }

    async fn initialized(&self, params: InitializedParams) {
        backend_trace!(self, "initialized({:?})", params);
    }

    async fn shutdown(&self) -> Result<()> {
        backend_trace!(self, "shutdown()");
        Ok(())
    }

    async fn did_change_workspace_folders(&self, params: DidChangeWorkspaceFoldersParams) {
        backend_trace!(self, "did_change_workspace_folders({:?})", params);

        // TODO: Re-start indexer with new folders.
    }

    async fn did_change_configuration(&self, params: DidChangeConfigurationParams) {
        backend_trace!(self, "did_change_configuration({:?})", params);
    }

    async fn did_change_watched_files(&self, params: DidChangeWatchedFilesParams) {
        backend_trace!(self, "did_change_watched_files({:?})", params);

        // TODO: Re-index the changed files.
    }

    async fn symbol(
        &self,
        params: WorkspaceSymbolParams,
    ) -> Result<Option<Vec<SymbolInformation>>> {
        backend_trace!(self, "symbol({:?})", params);

        let response = unwrap!(symbols::symbols(self, &params), Err(error) => {
            error!("{:?}", error);
            return Ok(None);
        });

        Ok(Some(response))
    }

    async fn document_symbol(
        &self,
        params: DocumentSymbolParams,
    ) -> Result<Option<DocumentSymbolResponse>> {
        backend_trace!(self, "document_symbols({})", params.text_document.uri);

        let response = unwrap!(symbols::document_symbols(self, &params), Err(error) => {
            error!("{:?}", error);
            return Ok(None);
        });

        Ok(Some(DocumentSymbolResponse::Nested(response)))
    }

    async fn execute_command(&self, params: ExecuteCommandParams) -> Result<Option<Value>> {
        backend_trace!(self, "execute_command({:?})", params);

        match self.client.apply_edit(WorkspaceEdit::default()).await {
            Ok(res) if res.applied => self.client.log_message(MessageType::INFO, "applied").await,
            Ok(_) => self.client.log_message(MessageType::INFO, "rejected").await,
            Err(err) => self.client.log_message(MessageType::ERROR, err).await,
        }

        Ok(None)
    }

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        backend_trace!(self, "did_open({}", params.text_document.uri);

        self.documents.insert(
            params.text_document.uri,
            Document::new(params.text_document.text.as_str()),
        );
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        backend_trace!(self, "did_change({:?})", params);

        // get reference to document
        let uri = &params.text_document.uri;
        let mut doc = unwrap!(self.documents.get_mut(uri), None => {
            backend_trace!(self, "did_change(): unexpected document uri '{}'", uri);
            return;
        });

        // respond to document updates
        if let Err(error) = doc.on_did_change(&params) {
            backend_trace!(
                self,
                "did_change(): unexpected error applying updates {}",
                error
            );
            return;
        }

        // update index
        if let Ok(path) = uri.to_file_path() {
            let path = Path::new(&path);
            if let Err(error) = indexer::update(&doc, &path) {
                error!("{:?}", error);
            }
        }

        // publish diagnostics
        let version = params.text_document.version;
        diagnostics::enqueue_diagnostics(self.clone(), uri.clone(), version).await;
    }

    async fn did_save(&self, params: DidSaveTextDocumentParams) {
        backend_trace!(self, "did_save({:?}", params);
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        backend_trace!(self, "did_close({:?}", params);
    }

    async fn completion(&self, params: CompletionParams) -> Result<Option<CompletionResponse>> {
        backend_trace!(self, "completion({:?})", params);

        // get reference to document
        let uri = &params.text_document_position.text_document.uri;
        let mut document = unwrap!(self.documents.get_mut(uri), None => {
            backend_trace!(self, "completion(): No document associated with URI {}", uri);
            return Ok(None);
        });

        // check whether we should be providing completions
        let ok = can_provide_completions(document.value_mut(), &params).unwrap_or_else(|err| {
            error!("{:?}", err);
            return false;
        });

        if !ok {
            return Ok(None);
        }

        // TODO: These probably shouldn't be separate methods, because we might get
        // the same completion from multiple sources, e.g.
        //
        // - A completion for a function 'foo' defined in the current document,
        // - A completion for a function 'foo' defined in the workspace,
        // - A variable called 'foo' defined in the current R session.
        //
        // Really, what's relevant is which of the above should be considered
        // 'visible' to the user.

        // build completion context
        let context = completion_context(document.value_mut(), &params.text_document_position);
        let context = unwrap!(context, Err(error) => {
            error!("{:?}", error);
            return Ok(None);
        });

        // start building completions
        let mut completions: Vec<CompletionItem> = vec![];

        log::info!("Completion context: {:#?}", context);

        // add session completions
        let result = r_lock! { append_session_completions(&context, &mut completions) };
        if let Err(error) = result {
            error!("{:?}", error);
        }

        // add context-relevant completions
        let result = append_document_completions(&context, &mut completions);
        if let Err(error) = result {
            error!("{:?}", error);
        }

        // add workspace completions
        let result = append_workspace_completions(&self, &context, &mut completions);
        if let Err(error) = result {
            error!("{:?}", error);
        }

        // remove duplicates
        let mut uniques = HashSet::new();
        completions.retain(|x| uniques.insert(x.label.clone()));

        // remove 'hidden' completions if necessary
        if !context.include_hidden {
            completions.retain(|x| !x.label.starts_with("."));
        }

        // sort completions by providing custom 'sort' text to be used when
        // ordering completion results. we use some placeholders at the front
        // to 'bin' different completion types differently; e.g. we place parameter
        // completions at the front, and completions starting with non-word
        // characters at the end (e.g. completions starting with `.`)
        let pattern = Regex::new(r"^\w").unwrap();
        for item in &mut completions {
            case! {

                item.kind == Some(CompletionItemKind::FIELD) => {
                    item.sort_text = Some(join!["1", item.label]);
                }

                item.kind == Some(CompletionItemKind::VARIABLE) => {
                    item.sort_text = Some(join!["2", item.label]);
                }

                pattern.is_match(&item.label) => {
                    item.sort_text = Some(join!["3", item.label]);
                }

                => {
                    item.sort_text = Some(join!["4", item.label]);
                }

            }
        }

        if !completions.is_empty() {
            Ok(Some(CompletionResponse::Array(completions)))
        } else {
            Ok(None)
        }
    }

    async fn completion_resolve(&self, mut item: CompletionItem) -> Result<CompletionItem> {
        backend_trace!(self, "completion_resolve({:?})", item);

        let data = item.data.clone();
        let data = unwrap!(data, None => {
            warn!("Completion '{}' has no associated data", item.label);
            return Ok(item);
        });

        let data: CompletionData = unwrap!(serde_json::from_value(data), Err(error) => {
            error!("{:?}", error);
            return Ok(item);
        });

        unsafe {
            unwrap!(resolve_completion_item(&mut item, &data), Err(error) => {
                error!("{:?}", error);
                return Ok(item);
            });
        }

        Ok(item)
    }

    async fn hover(&self, params: HoverParams) -> Result<Option<Hover>> {
        backend_trace!(self, "hover({:?})", params);

        // get document reference
        let uri = &params.text_document_position_params.text_document.uri;
        let document = unwrap!(self.documents.get_mut(uri), None => {
            backend_trace!(self, "hover(): No document associated with URI {}", uri);
            return Ok(None);
        });

        // build completion context
        let context = completion_context(&document, &params.text_document_position_params);
        let context = unwrap!(context, Err(error) => {
            error!("{:?}", error);
            return Ok(None);
        });

        // request hover information
        let result = unsafe { hover(&document, &context) };

        // unwrap errors
        let result = unwrap!(result, Err(error) => {
            error!("{:?}", error);
            return Ok(None);
        });

        // unwrap empty options
        let result = unwrap!(result, None => {
            return Ok(None);
        });

        // we got a result; use it
        Ok(Some(Hover {
            contents: HoverContents::Markup(result),
            range: None,
        }))
    }

    async fn signature_help(&self, params: SignatureHelpParams) -> Result<Option<SignatureHelp>> {
        // get document reference
        let uri = &params.text_document_position_params.text_document.uri;
        let document = unwrap!(self.documents.get_mut(uri), None => {
            backend_trace!(self, "signature_help(): No document associated with URI {}", uri);
            return Ok(None);
        });

        // request signature help
        let position = params.text_document_position_params.position;
        let result = unsafe { signature_help(document.value(), &position) };

        // unwrap errors
        let result = unwrap!(result, Err(error) => {
            error!("{:?}", error);
            return Ok(None);
        });

        // unwrap empty options
        let result = unwrap!(result, None => {
            return Ok(None);
        });

        Ok(Some(result))
    }

    async fn goto_definition(
        &self,
        params: GotoDefinitionParams,
    ) -> Result<Option<GotoDefinitionResponse>> {
        backend_trace!(self, "goto_definition({:?})", params);

        // get reference to document
        let uri = &params.text_document_position_params.text_document.uri;
        let document = unwrap!(self.documents.get(uri), None => {
            backend_trace!(self, "completion(): No document associated with URI {}", uri);
            return Ok(None);
        });

        // build goto definition context
        let result = unwrap!(unsafe { goto_definition(&document, params) }, Err(error) => {
            error!("{}", error);
            return Ok(None);
        });

        Ok(result)
    }

    async fn goto_implementation(
        &self,
        params: GotoImplementationParams,
    ) -> Result<Option<GotoImplementationResponse>> {
        backend_trace!(self, "goto_implementation({:?})", params);
        let _ = params;
        error!("Got a textDocument/implementation request, but it is not implemented");
        return Ok(None);
    }

    async fn references(&self, params: ReferenceParams) -> Result<Option<Vec<Location>>> {
        backend_trace!(self, "references({:?})", params);

        let locations = match self.find_references(params) {
            Ok(locations) => locations,
            Err(_error) => {
                return Ok(None);
            },
        };

        if locations.is_empty() {
            Ok(None)
        } else {
            Ok(Some(locations))
        }
    }
}

// Custom methods for the backend.
//
// NOTE: Request / notification methods _must_ accept a params object,
// even for notifications that don't include any auxiliary data.
//
// I'm not positive, but I think this is related to the way VSCode
// serializes parameters for notifications / requests when no data
// is supplied. Instead of supplying "nothing", it supplies something
// like `[null]` which tower_lsp seems to quietly reject when attempting
// to invoke the registered method.
//
// See also:
//
// https://github.com/Microsoft/vscode-languageserver-node/blob/18fad46b0e8085bb72e1b76f9ea23a379569231a/client/src/common/client.ts#L802-L838
// https://github.com/Microsoft/vscode-languageserver-node/blob/18fad46b0e8085bb72e1b76f9ea23a379569231a/client/src/common/client.ts#L701-L752
impl Backend {
    async fn request(&self, params: Option<Value>) -> Result<i32> {
        info!("Received Positron request: {:?}", params);
        Ok(42)
    }

    async fn notification(&self, params: Option<Value>) {
        info!("Received Positron notification: {:?}", params);
    }
}

#[tokio::main]
pub async fn start_lsp(
    address: String,
    shell_request_tx: Sender<Request>,
    comm_manager_tx: Sender<CommEvent>,
    lsp_initialized: bool,
) {
    #[cfg(feature = "runtime-agnostic")]
    use tokio_util::compat::TokioAsyncReadCompatExt;
    #[cfg(feature = "runtime-agnostic")]
    use tokio_util::compat::TokioAsyncWriteCompatExt;

    debug!("Connecting to LSP at '{}'", &address);
    let listener = TcpListener::bind(&address).await.unwrap();
    let (stream, _) = listener.accept().await.unwrap();
    debug!("Connected to LSP at '{}'", address);
    let (read, write) = tokio::io::split(stream);

    #[cfg(feature = "runtime-agnostic")]
    let (read, write) = (read.compat(), write.compat_write());

    let init = |client: Client| {
        // initialize shared globals (needed for R callbacks)
        globals::initialize(
            client.clone(),
            shell_request_tx.clone(),
            comm_manager_tx.clone(),
        );

        // create backend
        let backend = Backend {
            client,
            documents: DOCUMENT_INDEX.clone(),
            workspace: Arc::new(Mutex::new(Workspace::default())),
            shell_request_tx: shell_request_tx.clone(),
            lsp_initialized,
        };

        backend
    };

    let (service, socket) = LspService::build(init)
        .custom_method("positron/request", Backend::request)
        .custom_method("positron/notification", Backend::notification)
        .finish();

    Server::new(read, write, socket).serve(service).await;
    debug!(
        "LSP thread exiting gracefully after connection closed ({:?}).",
        address
    );
}
