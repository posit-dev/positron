//
// backend.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::mpsc::SyncSender;

use dashmap::DashMap;
use harp::r_lock;
use log::*;
use regex::Regex;
use serde_json::Value;
use stdext::*;
use tokio::net::TcpStream;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::*;
use tower_lsp::{Client, LanguageServer, LspService, Server};

use crate::lsp::completions::append_session_completions;
use crate::lsp::completions::can_provide_completions;
use crate::lsp::completions::append_document_completions;
use crate::lsp::completions::completion_context;
use crate::lsp::document::Document;
use crate::lsp::modules;
use crate::request::Request;

macro_rules! backend_trace {

    ($self: expr, $($rest: expr),*) => {{
        let message = format!($($rest, )*);
        $self.client.log_message(tower_lsp::lsp_types::MessageType::INFO, message).await
    }};

}

#[derive(Debug)]
pub(crate) struct Workspace {
    pub folders: Vec<Url>,
}

impl Default for Workspace {

    fn default() -> Self {
        Self { folders: Default::default() }
    }

}

#[derive(Debug)]
pub(crate) struct Backend {
    pub client: Client,
    pub documents: DashMap<Url, Document>,
    pub workspace: Arc<Mutex<Workspace>>,
    #[allow(dead_code)]
    pub channel: SyncSender<Request>,
}

impl Backend {

    pub(crate) fn with_document<T, F>(&self, path: &Path, mut callback: F) -> std::result::Result<T, ()>
    where
        F: FnMut(&Document) -> std::result::Result<T, ()>
    {
        let mut fallback = || {

            let contents = unwrap!(std::fs::read_to_string(path), {
                info!("reading from {:?} failed", path);
                return Err(());
            });


            let document = Document::new(contents.as_str());
            return callback(&document);

        };

        // If we have a cached copy of the document (because we're monitoring it)
        // then use that; otherwise, try to read the document from the provided
        // path and use that instead.
        let uri = unwrap!(Url::from_file_path(path), {
            info!("couldn't construct uri from {:?}; using fallback", path);
            return fallback();
        });


        let document = unwrap!(self.documents.get(&uri), {
            info!("no document for uri {:?}; using fallback", uri);
            return fallback();
        });

        return callback(document.value());

    }

}

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, params: InitializeParams) -> Result<InitializeResult> {

        backend_trace!(self, "initialize({:#?})", params);

        // initialize the set of known workspaces
        let mut folders: Vec<String> = Vec::new();
        if let Ok(mut workspace) = self.workspace.lock() {

            // initialize the workspace folders
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

        }

        // initialize our support functions
        r_lock! { modules::initialize() };

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
                    resolve_provider: Some(false),
                    trigger_characters: Some(vec![
                        "$".to_string(),
                        "@".to_string(),
                        ":".to_string(),
                    ]),
                    work_done_progress_options: Default::default(),
                    all_commit_characters: None,
                    ..Default::default()
                }),
                signature_help_provider: None,
                definition_provider: None,
                type_definition_provider: None,
                implementation_provider: None,
                references_provider: Some(OneOf::Left(true)),
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
    }

    async fn did_change_configuration(&self, params: DidChangeConfigurationParams) {
        backend_trace!(self, "did_change_configuration({:?})", params);
    }

    async fn did_change_watched_files(&self, params: DidChangeWatchedFilesParams) {
        backend_trace!(self, "did_change_watched_files({:?})", params);
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
        backend_trace!(self, "did_open({:?}", params);

        self.documents.insert(
            params.text_document.uri,
            Document::new(params.text_document.text.as_str()),
        );

    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        backend_trace!(self, "did_change({:?})", params);

        // get reference to document
        let uri = &params.text_document.uri;
        let mut doc = unwrap!(self.documents.get_mut(uri), {
            backend_trace!(self, "did_change(): unexpected document uri '{}'", uri);
            return;
        });

        // update the document
        for change in params.content_changes.iter() {
            if let Err(error) = doc.update(change) {
                backend_trace!(self, "doc.update(): unexpected error {}", error);
            }
        }

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
        let mut document = unwrap!(self.documents.get_mut(uri), {
            backend_trace!(self, "completion(): No document associated with URI {}", uri);
            return Ok(None);
        });

        // check whether we should be providing completions
        let ok = can_provide_completions(document.value_mut(), &params).unwrap_or_else(|err| {
            error!("{}", err);
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
        let context = unwrap!(completion_context(document.value_mut(), params), error {
            error!("{}", error);
            return Ok(None);
        });

        info!("Completion token at point {:?}: '{}'", context.point, context.token);

        // start building completions
        let mut completions : Vec<CompletionItem> = vec!();

        // add session completions
        let result = append_session_completions(&context, &mut completions);
        if let Err(error) = result {
            backend_trace!(self, "append_session_completions(): unexpected error {}", error);
        }

        // add context-relevant completions
        let result = append_document_completions(&context, &mut completions);
        if let Err(error) = result {
            backend_trace!(self, "append_session_completions(): unexpected error {}", error);
        }

        // remove duplicates
        let mut uniques = HashSet::new();
        completions.retain(|x| { uniques.insert(x.label.clone()) });

        // sort completions by providing custom 'sort' text to be used when
        // ordering completion results. we use some placeholders at the front
        // to 'bin' different completion types differently; e.g. we place parameter
        // completions at the front, and completions starting with non-word
        // characters at the end (e.g. completions starting with `.`)
        let pattern = Regex::new(r"^\w").unwrap();
        for item in &mut completions {
            if item.kind == Some(CompletionItemKind::FIELD) {
                item.sort_text = Some(format!("1{}", item.label));
            } else if pattern.is_match(&item.label) {
                item.sort_text = Some(format!("2{}", item.label));
            } else {
                item.sort_text = Some(format!("9{}", item.label));
            }
        }

        if !completions.is_empty() {
            Ok(Some(CompletionResponse::Array(completions)))
        } else {
            Ok(None)
        }

    }

    async fn hover(&self, params: HoverParams) -> Result<Option<Hover>> {
        backend_trace!(self, "hover({:?})", params);
        Ok(Some(Hover {
            contents: HoverContents::Scalar(MarkedString::from_markdown(String::from(
                "Hello world!",
            ))),
            range: None,
        }))
    }

    async fn references(&self, params: ReferenceParams) -> Result<Option<Vec<Location>>> {
        backend_trace!(self, "references({:?})", params);

        let locations = match self.find_references(params) {
            Ok(locations) => locations,
            Err(_error) => { return Ok(None); }
        };

        if locations.is_empty() {
            Ok(None)
        } else {
            Ok(Some(locations))
        }
    }
}

#[tokio::main]
pub async fn start_lsp(address: String, channel: SyncSender<Request>) {

    #[cfg(feature = "runtime-agnostic")]
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

    /*
    NOTE: The example LSP from tower-lsp uses a TcpListener, but we're using a
    TcpStream because -- according to LSP docs -- the client and server roles
    are reversed in terms of opening ports: the client listens, and the server
    opens a connection to it. The client and server can't BOTH listen on the port,
    so we let the client do it and connect to it here.

    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
        .await
        .unwrap();
    let (stream, _) = listener.accept().await.unwrap();
    */
    debug!("Connecting to LSP client at '{}'", address);
    let stream = TcpStream::connect(address).await.unwrap();
    let (read, write) = tokio::io::split(stream);
    #[cfg(feature = "runtime-agnostic")]
    let (read, write) = (read.compat(), write.compat_write());

    let (service, socket) = LspService::new(|client| Backend {
        client: client,
        documents: DashMap::new(),
        workspace: Arc::new(Mutex::new(Workspace::default())),
        channel: channel,
    });

    Server::new(read, write, socket).serve(service).await;
}
