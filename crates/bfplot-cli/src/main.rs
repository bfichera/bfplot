use std::{
    borrow::Cow,
    collections::BTreeMap,
    fs,
    io::{self, Write},
    net::IpAddr,
    path::{Path, PathBuf},
    process::ExitCode,
    sync::Arc,
};

use anyhow::Context;
use axum::{
    Router,
    body::Body,
    extract::{Path as AxumPath, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use bfplot_core::{
    ArrayRef, Document, Manifest, ObjectId, ObjectStore, array_refs, compare_artifacts,
    load_artifact, locate_artifact, read_manifest, verify_artifact,
};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    version,
    about = "View, serve, hash, compare and verify BFPlot results"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print the hash of each result; equal hashes mean identical results.
    ///
    /// With one result only the hash is printed; with several, one `<hash>  <path>` line
    /// each, like `sha256sum`.
    Hash {
        #[arg(required = true)]
        artifacts: Vec<PathBuf>,
        /// Check every object of each result before printing its hash.
        #[arg(long)]
        verify: bool,
    },
    /// Report whether two results are identical, and if not, where they differ.
    ///
    /// Exits with 0 if the results are identical, 1 if they differ and 2 on error.
    Compare {
        first: PathBuf,
        second: PathBuf,
        /// Print nothing; only set the exit status.
        #[arg(long, short)]
        quiet: bool,
        /// Check every object of both results first.
        #[arg(long)]
        verify: bool,
    },
    /// Verify the manifest, document and the SHA-256 of every object.
    Verify { artifact: PathBuf },
    /// Print the manifest TOML exactly as stored.
    ///
    /// Suitable as a Git textconv: `git config diff.bfplot.textconv "bfplot manifest"`.
    Manifest { artifact: PathBuf },
    /// Serve a result over HTTP (loopback by default).
    Serve {
        artifact: PathBuf,
        #[arg(long, default_value = "127.0.0.1")]
        bind: IpAddr,
        #[arg(long, default_value_t = 8080)]
        port: u16,
        /// Serve the viewer from this built directory instead of the copy embedded in
        /// bfplot (for viewer development; also read from BFPLOT_VIEWER_DIR).
        #[arg(long, env = "BFPLOT_VIEWER_DIR")]
        viewer_dir: Option<PathBuf>,
    },
    /// Serve a result and open it in the default browser.
    View {
        artifact: PathBuf,
        #[arg(long, default_value = "127.0.0.1")]
        bind: IpAddr,
        #[arg(long, default_value_t = 8080)]
        port: u16,
        /// Serve the viewer from this built directory instead of the embedded copy.
        #[arg(long, env = "BFPLOT_VIEWER_DIR")]
        viewer_dir: Option<PathBuf>,
    },
}

fn main() -> ExitCode {
    let command = Cli::parse().command;
    let failure = match command {
        Command::Compare { .. } => ExitCode::from(2),
        _ => ExitCode::FAILURE,
    };
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("error: {error}");
            return failure;
        }
    };
    match runtime.block_on(run(command)) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("error: {}", error_message(&error));
            failure
        }
    }
}

/// The error and its causes, skipping causes whose text an outer message already includes.
fn error_message(error: &anyhow::Error) -> String {
    let mut message = error.to_string();
    for cause in error.chain().skip(1) {
        let cause = cause.to_string();
        if !message.contains(&cause) {
            message = format!("{message}: {cause}");
        }
    }
    message
}

async fn run(command: Command) -> anyhow::Result<ExitCode> {
    match command {
        Command::Hash { artifacts, verify } => {
            let mut stdout = io::stdout().lock();
            for artifact in &artifacts {
                let hash = result_hash(artifact, verify)?;
                if artifacts.len() == 1 {
                    writeln!(stdout, "{hash}")?;
                } else {
                    writeln!(stdout, "{hash}  {}", artifact.display())?;
                }
            }
        }
        Command::Compare {
            first,
            second,
            quiet,
            verify,
        } => {
            if verify {
                verify_artifact(&first).with_context(|| format!("verify {}", first.display()))?;
                verify_artifact(&second).with_context(|| format!("verify {}", second.display()))?;
            }
            let comparison = compare_artifacts(&first, &second)?;
            if !quiet {
                print!("{}", comparison_report(&comparison, &first, &second));
            }
            if !comparison.same() {
                return Ok(ExitCode::from(1));
            }
        }
        Command::Verify { artifact } => {
            let report = verify_artifact(&artifact)?;
            println!(
                "verified {} objects ({} bytes)\n{}",
                report.object_count, report.byte_count, report.hash
            );
        }
        Command::Manifest { artifact } => {
            let mut stdout = io::stdout().lock();
            stdout.write_all(&manifest_bytes(&artifact)?)?;
            stdout.flush()?;
        }
        Command::Serve {
            artifact,
            bind,
            port,
            viewer_dir,
        } => serve(artifact, bind, port, viewer_dir, false).await?,
        Command::View {
            artifact,
            bind,
            port,
            viewer_dir,
        } => serve(artifact, bind, port, viewer_dir, true).await?,
    }
    Ok(ExitCode::SUCCESS)
}

fn result_hash(path: &Path, verify: bool) -> anyhow::Result<String> {
    let hash = if verify {
        verify_artifact(path)?.hash
    } else {
        read_manifest(path)?.hash
    };
    Ok(hash.to_string())
}

/// At most this many differences are listed by `bfplot compare`.
const MAX_DIFFERENCES: usize = 50;

fn comparison_report(comparison: &bfplot_core::Comparison, first: &Path, second: &Path) -> String {
    use std::fmt::Write;

    let mut text = String::new();
    if comparison.same() {
        let _ = writeln!(text, "identical {}", comparison.first);
        return text;
    }
    let _ = writeln!(text, "different");
    let _ = writeln!(text, "  {}  {}", comparison.first, first.display());
    let _ = writeln!(text, "  {}  {}", comparison.second, second.display());
    for difference in comparison.differences.iter().take(MAX_DIFFERENCES) {
        let _ = writeln!(text, "{difference}");
    }
    if comparison.differences.len() > MAX_DIFFERENCES {
        let _ = writeln!(
            text,
            "... and {} more differences",
            comparison.differences.len() - MAX_DIFFERENCES
        );
    }
    text
}

fn manifest_bytes(path: &Path) -> anyhow::Result<Vec<u8>> {
    let (manifest_path, _) = locate_artifact(path);
    fs::read(&manifest_path).with_context(|| format!("read {}", manifest_path.display()))
}

#[derive(Clone)]
struct ServeState {
    hash: Arc<String>,
    manifest: Arc<Vec<u8>>,
    document: Arc<Vec<u8>>,
    objects: ObjectStore,
    /// The arrays the document references, by digest; only these objects are served.
    arrays: Arc<BTreeMap<ObjectId, ArrayRef>>,
    viewer: Viewer,
}

/// A verified result directory.
struct ServeArtifact {
    manifest: Vec<u8>,
    manifest_data: Manifest,
    document: Document,
    objects: ObjectStore,
}

async fn serve(
    path: PathBuf,
    bind: IpAddr,
    port: u16,
    viewer_dir: Option<PathBuf>,
    open_browser: bool,
) -> anyhow::Result<()> {
    let artifact = prepare_serve_artifact(&path)?;
    let viewer_document_bytes = viewer_document(&artifact.document, &artifact.manifest_data)?;
    let viewer = Viewer::new(viewer_dir)?;
    let state_hash = artifact.manifest_data.hash.to_string();
    let state = ServeState {
        hash: Arc::new(artifact.manifest_data.hash.to_string()),
        manifest: Arc::new(artifact.manifest),
        document: Arc::new(viewer_document_bytes),
        objects: artifact.objects,
        arrays: Arc::new(served_arrays(&artifact.document)),
        viewer,
    };
    let app = Router::new()
        .route("/", get(index))
        .route("/hash", get(hash))
        .route("/manifest", get(manifest))
        .route("/document", get(document))
        .route("/objects/sha256/{digest}", get(object))
        .route("/viewer/{*path}", get(viewer_asset))
        .with_state(state);
    let address = (bind, port);
    let listener = tokio::net::TcpListener::bind(address).await?;
    let url = format!("http://{}", listener.local_addr()?);
    eprintln!("serving {state_hash} at {url}");
    if open_browser {
        open_default_browser(&url)?;
    }
    axum::serve(listener, app).await?;
    Ok(())
}

fn prepare_serve_artifact(path: &Path) -> anyhow::Result<ServeArtifact> {
    verify_artifact(path)?;
    let artifact = load_artifact(path)?;
    Ok(ServeArtifact {
        manifest: manifest_bytes(path)?,
        manifest_data: artifact.manifest,
        document: artifact.document,
        objects: artifact.store,
    })
}

async fn index(State(state): State<ServeState>) -> Response {
    match state.viewer.asset("index.html") {
        Some(index) => bytes_response(
            String::from_utf8_lossy(&index)
                .replace("\"./", "\"/viewer/")
                .into_bytes(),
            "text/html; charset=utf-8",
        ),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
async fn hash(State(state): State<ServeState>) -> Response {
    bytes_response(
        format!("{}\n", state.hash).into_bytes(),
        "text/plain; charset=utf-8",
    )
}
async fn manifest(State(state): State<ServeState>) -> Response {
    bytes_response(state.manifest.as_ref().clone(), "application/toml")
}
async fn document(State(state): State<ServeState>) -> Response {
    bytes_response(state.document.as_ref().clone(), "application/json")
}
async fn object(State(state): State<ServeState>, AxumPath(digest): AxumPath<String>) -> Response {
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let id: ObjectId = match format!("sha256:{digest}").parse() {
        Ok(id) => id,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    // An array is named by the digest of its decoded bytes, so it is checked by decoding;
    // the stored (compressed) bytes are sent, and the viewer decodes them.
    let Some(reference) = state.arrays.get(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match state.objects.get_array_stored(reference) {
        Ok(bytes) => bytes_response(bytes, "application/octet-stream"),
        Err(bfplot_core::Error::ObjectNotFound(_)) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::UNPROCESSABLE_ENTITY.into_response(),
    }
}

fn served_arrays(document: &Document) -> BTreeMap<ObjectId, ArrayRef> {
    array_refs(document)
        .0
        .into_iter()
        .map(|reference| (reference.object.clone(), reference))
        .collect()
}

async fn viewer_asset(
    State(state): State<ServeState>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    if Path::new(&path)
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some(bytes) = state.viewer.asset(&path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let content_type = match Path::new(&path)
        .extension()
        .and_then(|value| value.to_str())
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("map") | Some("json") => "application/json",
        Some("woff2") => "font/woff2",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
    bytes_response(bytes.into_owned(), content_type)
}

fn open_default_browser(url: &str) -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", ""]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(url);
    command.spawn().context("launch default browser")?;
    Ok(())
}

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/viewer_assets.rs"));
}

/// Where the browser viewer's files come from.
#[derive(Clone, Debug)]
enum Viewer {
    /// The copy compiled into this binary.
    Embedded,
    /// A built `viewer/dist`, for viewer development.
    Directory(PathBuf),
}

impl Viewer {
    fn new(directory: Option<PathBuf>) -> anyhow::Result<Self> {
        let Some(directory) = directory else {
            return Ok(Self::Embedded);
        };
        anyhow::ensure!(
            directory.join("index.html").is_file(),
            "{} is not a built viewer (no index.html); run `npm --prefix viewer run build`",
            directory.display()
        );
        Ok(Self::Directory(directory))
    }

    /// The bytes of `path` (relative, `/`-separated), if the viewer has that file.
    fn asset(&self, path: &str) -> Option<Cow<'static, [u8]>> {
        match self {
            Self::Embedded => embedded::ASSETS
                .iter()
                .find(|(name, _)| *name == path)
                .map(|(_, bytes)| Cow::Borrowed(*bytes)),
            Self::Directory(root) => fs::read(root.join(path)).ok().map(Cow::Owned),
        }
    }
}

/// Flatten a document into the `figures`/`axes`/`artists` lists the viewer expects.
fn viewer_document(document: &Document, manifest: &Manifest) -> anyhow::Result<Vec<u8>> {
    use serde_json::{Map, Value, json};

    let mut figures = Vec::new();
    let mut axes_values = Vec::new();
    let mut artists = Vec::new();
    for figure in &document.figures {
        let mut figure_value = Map::new();
        figure_value.insert("id".into(), Value::String(figure.id.clone()));
        for (key, value) in &figure.properties {
            figure_value.insert(key.clone(), value.clone());
        }
        figure_value.insert(
            "axes".into(),
            Value::Array(
                figure
                    .axes
                    .iter()
                    .map(|axes| Value::String(axes.id.clone()))
                    .collect(),
            ),
        );
        figures.push(Value::Object(figure_value));

        for axes in &figure.axes {
            let mut axes_value = Map::new();
            axes_value.insert("id".into(), Value::String(axes.id.clone()));
            axes_value.insert("figure_id".into(), Value::String(figure.id.clone()));
            for (key, value) in &axes.properties {
                axes_value.insert(key.clone(), value.clone());
            }
            normalize_python_axes(&mut axes_value);
            axes_values.push(Value::Object(axes_value));
            artists.extend(
                axes.artists
                    .iter()
                    .map(serde_json::to_value)
                    .collect::<Result<Vec<_>, _>>()?,
            );
        }
    }
    serde_json::to_vec(&json!({
        "figures": figures,
        "axes": axes_values,
        "artists": artists,
        "timeline": document.timeline,
        "hash": manifest.hash.to_string(),
    }))
    .map_err(Into::into)
}

fn normalize_python_axes(axes: &mut serde_json::Map<String, serde_json::Value>) {
    let projection = match axes.get("projection").and_then(|value| value.as_str()) {
        Some("3d") => "3d",
        _ => "2d",
    };
    axes.insert("projection".into(), projection.into());
    if let Some(bounds) = axes.remove("bounds") {
        axes.insert("position".into(), bounds);
    }
    for dimension in ["x", "y", "z"] {
        let Some(serde_json::Value::Object(axis)) = axes.remove(dimension) else {
            continue;
        };
        for (source, suffix) in [
            ("label", "label"),
            ("scale", "scale"),
            ("limits", "lim"),
            ("ticks", "ticks"),
            ("ticklabels", "ticklabels"),
            ("date_epoch", "date_epoch"),
            ("date_format", "date_format"),
        ] {
            if let Some(value) = axis.get(source) {
                axes.insert(format!("{dimension}{suffix}"), value.clone());
            }
        }
    }
}

fn bytes_response(bytes: Vec<u8>, content_type: &'static str) -> Response {
    let mut response = Response::new(Body::from(bytes));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use bfplot_core::ObjectId;
    use clap::Parser;

    #[test]
    fn serve_defaults_to_loopback() {
        let cli = Cli::try_parse_from(["bfplot", "serve", "plot.bfplot"]).unwrap();
        let Command::Serve { bind, port, .. } = cli.command else {
            panic!("expected serve command");
        };
        assert!(bind.is_loopback());
        assert_eq!(port, 8080);
    }

    #[test]
    fn flattens_python_document_for_viewer() {
        let document: Document = serde_json::from_str(include_str!(
            "../../bfplot-core/tests/fixtures/python-document.json"
        ))
        .unwrap();
        let manifest = Manifest::new(ObjectId::of(b"document"));
        let value: serde_json::Value =
            serde_json::from_slice(&viewer_document(&document, &manifest).unwrap()).unwrap();
        assert_eq!(value["axes"][0]["xlim"], serde_json::json!([0.0, 1.0]));
        assert_eq!(
            value["axes"][0]["position"],
            serde_json::json!([0.125, 0.11, 0.775, 0.77])
        );
        assert_eq!(value["axes"][0]["projection"], "2d");
        assert_eq!(value["artists"][0]["id"], "artist-0");
        assert_eq!(value["figures"][0]["axes"][0], "figure-0-axes-0");
        assert_eq!(value["figures"][0]["name"], "spectrum");
        assert_eq!(value["hash"], ObjectId::of(b"document").to_string());
        assert!(value.get("metadata").is_none());
    }

    #[test]
    fn prepares_a_result_for_the_server() {
        let directory = tempfile::tempdir().unwrap();
        let result = directory.path().join("fit.bfplot");
        let store = ObjectStore::for_result_dir(&result);
        let mut document = Document::default();
        document.figures.push(bfplot_core::Figure {
            id: "figure".into(),
            axes: Vec::new(),
            properties: [("name".to_string(), serde_json::json!("spectrum"))].into(),
        });
        let document_id = store.put_json(&document).unwrap();
        let manifest_text = toml::to_string(&Manifest::new(document_id.clone())).unwrap();
        fs::write(result.join("manifest.toml"), &manifest_text).unwrap();
        fs::write(result.join(".gitignore"), "/objects/\n").unwrap();

        for source in [&result, &result.join("manifest.toml")] {
            let served = prepare_serve_artifact(source).unwrap();
            assert_eq!(served.manifest, manifest_text.as_bytes());
            assert_eq!(served.document.figures[0].properties["name"], "spectrum");
            assert!(served.objects.get(&document_id).is_ok());
            assert_eq!(manifest_bytes(source).unwrap(), manifest_text.as_bytes());
            let value: serde_json::Value = serde_json::from_slice(
                &viewer_document(&served.document, &served.manifest_data).unwrap(),
            )
            .unwrap();
            assert_eq!(value["figures"][0]["name"], "spectrum");
        }
    }

    fn serve_state(viewer: Viewer) -> (ServeState, tempfile::TempDir) {
        let directory = tempfile::tempdir().unwrap();
        let result = directory.path().join("fit.bfplot");
        let id = ObjectStore::for_result_dir(&result)
            .put_json(&Document::default())
            .unwrap();
        let manifest = toml::to_string(&Manifest::new(id)).unwrap();
        fs::write(result.join("manifest.toml"), &manifest).unwrap();
        fs::write(result.join(".gitignore"), "/objects/\n").unwrap();
        let artifact = prepare_serve_artifact(&result).unwrap();
        let state = ServeState {
            hash: Arc::new(artifact.manifest_data.hash.to_string()),
            manifest: Arc::new(artifact.manifest),
            document: Arc::new(Vec::new()),
            arrays: Arc::new(served_arrays(&artifact.document)),
            objects: artifact.objects,
            viewer,
        };
        (state, directory)
    }

    async fn body(response: Response) -> (StatusCode, String, Vec<u8>) {
        let status = response.status();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .map(|value| value.to_str().unwrap().to_owned())
            .unwrap_or_default();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, content_type, bytes.to_vec())
    }

    #[test]
    fn embeds_only_the_runtime_viewer_files() {
        let names: Vec<_> = embedded::ASSETS.iter().map(|(name, _)| *name).collect();
        for required in ["index.html", "app.js", "index.js", "style.css", "fzstd.js"] {
            assert!(names.contains(&required), "missing {required}");
        }
        assert!(names.iter().any(|name| name.starts_with("fonts/")));
        assert!(
            !names
                .iter()
                .any(|name| name.ends_with(".map") || name.ends_with(".d.ts"))
        );
    }

    #[tokio::test]
    async fn serves_the_embedded_viewer_without_any_files_on_disk() {
        let (state, _directory) = serve_state(Viewer::new(None).unwrap());

        let (status, content_type, page) = body(index(State(state.clone())).await).await;
        let page = String::from_utf8(page).unwrap();
        assert_eq!(status, StatusCode::OK);
        assert!(content_type.starts_with("text/html"));
        assert!(page.contains("src=\"/viewer/app.js\""));
        let (status, content_type, served_hash) = body(hash(State(state.clone())).await).await;
        assert_eq!(status, StatusCode::OK);
        assert!(content_type.starts_with("text/plain"));
        assert_eq!(
            String::from_utf8(served_hash).unwrap(),
            format!("{}\n", state.hash)
        );
        assert!(state.hash.starts_with("sha256:"));
        assert!(!page.contains("\"./"));

        let asset = |path: &str| viewer_asset(State(state.clone()), AxumPath(path.to_string()));
        let (status, content_type, script) = body(asset("app.js").await).await;
        assert_eq!(status, StatusCode::OK);
        assert!(content_type.starts_with("text/javascript"));
        assert_eq!(script, fs::read("../../viewer/dist/app.js").unwrap());
        let (_, content_type, _) = body(asset("fonts/cmu-serif-500-roman.woff2").await).await;
        assert_eq!(content_type, "font/woff2");
        assert_eq!(
            body(asset("missing.js").await).await.0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            body(asset("../Cargo.toml").await).await.0,
            StatusCode::BAD_REQUEST
        );
    }

    #[tokio::test]
    async fn a_viewer_directory_overrides_the_embedded_copy() {
        let viewer = tempfile::tempdir().unwrap();
        fs::write(
            viewer.path().join("index.html"),
            "<script src=\"./app.js\"></script>",
        )
        .unwrap();
        fs::write(viewer.path().join("app.js"), "// development build").unwrap();
        let (state, _directory) =
            serve_state(Viewer::new(Some(viewer.path().to_path_buf())).unwrap());

        let (_, _, page) = body(index(State(state.clone())).await).await;
        assert_eq!(page, b"<script src=\"/viewer/app.js\"></script>");
        let (_, _, script) =
            body(viewer_asset(State(state), AxumPath("app.js".into())).await).await;
        assert_eq!(script, b"// development build");

        let error = Viewer::new(Some(viewer.path().join("absent"))).unwrap_err();
        assert!(error.to_string().contains("is not a built viewer"));
    }

    #[test]
    fn all_required_commands_parse() {
        for arguments in [
            vec!["bfplot", "manifest", "in.bfplot"],
            vec!["bfplot", "verify", "in.bfplot"],
            vec!["bfplot", "view", "in.bfplot"],
            vec!["bfplot", "serve", "in.bfplot", "--port", "9000"],
            vec!["bfplot", "serve", "in.bfplot", "--bind", "0.0.0.0"],
            vec!["bfplot", "hash", "in.bfplot"],
            vec!["bfplot", "hash", "--verify", "a.bfplot", "b.bfplot"],
            vec!["bfplot", "compare", "a.bfplot", "b.bfplot"],
            vec![
                "bfplot", "compare", "-q", "--verify", "a.bfplot", "b.bfplot",
            ],
        ] {
            assert!(Cli::try_parse_from(arguments).is_ok());
        }
        for arguments in [
            vec!["bfplot", "hash"],
            vec!["bfplot", "compare", "a.bfplot"],
        ] {
            assert!(Cli::try_parse_from(arguments).is_err());
        }
    }

    fn write_result(path: &Path, title: &str) -> String {
        let mut document = Document::default();
        document.figures.push(bfplot_core::Figure {
            id: "figure".into(),
            axes: Vec::new(),
            properties: [("title".to_string(), serde_json::json!(title))].into(),
        });
        let hash = ObjectStore::for_result_dir(path)
            .put_json(&document)
            .unwrap();
        fs::write(
            path.join("manifest.toml"),
            toml::to_string(&Manifest::new(hash.clone())).unwrap(),
        )
        .unwrap();
        hash.to_string()
    }

    #[tokio::test]
    async fn serves_the_compressed_arrays_the_document_references() {
        let directory = tempfile::tempdir().unwrap();
        let result = directory.path().join("line.bfplot");
        let store = ObjectStore::for_result_dir(&result);
        let raw: Vec<u8> = [0.0f64, 1.0, 4.0]
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect();
        let reference = store.put_array(&raw, "f8", &[3]).unwrap();
        let mut document = Document::default();
        document.figures.push(bfplot_core::Figure {
            id: "figure-0".into(),
            axes: vec![bfplot_core::Axes {
                id: "axes-0".into(),
                artists: vec![bfplot_core::Artist {
                    artist_type: "bfplot.line".into(),
                    id: "artist-0".into(),
                    axes_id: "axes-0".into(),
                    props: Default::default(),
                    data: [("y".to_string(), serde_json::to_value(&reference).unwrap())].into(),
                }],
                properties: Default::default(),
            }],
            properties: Default::default(),
        });
        let hash = store.put_json(&document).unwrap();
        fs::write(
            result.join("manifest.toml"),
            toml::to_string(&Manifest::new(hash.clone())).unwrap(),
        )
        .unwrap();
        let artifact = prepare_serve_artifact(&result).unwrap();
        let state = ServeState {
            hash: Arc::new(hash.to_string()),
            manifest: Arc::new(artifact.manifest),
            document: Arc::new(Vec::new()),
            arrays: Arc::new(served_arrays(&artifact.document)),
            objects: artifact.objects,
            viewer: Viewer::new(None).unwrap(),
        };
        let fetch = |id: &ObjectId| {
            object(
                State(state.clone()),
                AxumPath(id.to_string().trim_start_matches("sha256:").to_string()),
            )
        };

        let (status, _, served) = body(fetch(&reference.object).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(served, store.read(&reference.object).unwrap());
        assert_eq!(bfplot_core::decode_array(&reference, &served).unwrap(), raw);
        // The document is not an array, and unreferenced objects are not served.
        assert_eq!(body(fetch(&hash).await).await.0, StatusCode::NOT_FOUND);
        let stray = store.put(b"stray").unwrap();
        assert_eq!(body(fetch(&stray).await).await.0, StatusCode::NOT_FOUND);
        // A damaged array is refused rather than served.
        let other = store.put_array(&[0u8; 24], "f8", &[3]).unwrap();
        fs::copy(store.path(&other.object), store.path(&reference.object)).unwrap();
        assert_eq!(
            body(fetch(&reference.object).await).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[test]
    fn error_messages_do_not_repeat_their_causes() {
        let missing = result_hash(Path::new("absent.bfplot"), false).unwrap_err();
        let message = error_message(&missing);
        assert_eq!(message.matches("os error").count(), 1, "{message}");
        let wrapped = missing.context("verify absent.bfplot");
        assert!(error_message(&wrapped).starts_with("verify absent.bfplot: I/O error at "));
    }

    #[test]
    fn hashes_and_compares_results() {
        let directory = tempfile::tempdir().unwrap();
        let [a, b, c] = ["a", "b", "c"].map(|name| directory.path().join(name));
        let hash = write_result(&a, "one");
        write_result(&b, "one");
        write_result(&c, "two");

        assert_eq!(result_hash(&a, false).unwrap(), hash);
        assert_eq!(result_hash(&a.join("manifest.toml"), true).unwrap(), hash);
        let same = compare_artifacts(&a, &b).unwrap();
        assert_eq!(
            comparison_report(&same, &a, &b),
            format!("identical {hash}\n")
        );
        let different = compare_artifacts(&a, &c).unwrap();
        let report = comparison_report(&different, &a, &c);
        assert!(report.starts_with("different\n"), "{report}");
        assert!(report.contains(&format!("  {hash}  {}", a.display())));
        assert!(
            report.ends_with("figures[0].title: \"one\" -> \"two\"\n"),
            "{report}"
        );

        fs::remove_dir_all(a.join("objects")).unwrap();
        assert_eq!(result_hash(&a, false).unwrap(), hash);
        assert!(result_hash(&a, true).is_err());
    }
}
