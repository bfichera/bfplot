use std::{
    borrow::Cow,
    fs,
    io::{self, Read, Write},
    net::IpAddr,
    path::{Path, PathBuf},
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
    Document, Manifest, ObjectStore, load_artifact, locate_artifact, pack_artifact,
    read_packed_manifest, unpack_artifact, verify_artifact, verify_packed,
};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(version, about = "Verify, pack, unpack and view BFPlot results")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Pack a result directory into one file.
    Pack { source: PathBuf, output: PathBuf },
    /// Unpack a packed file into a result directory.
    Unpack {
        artifact: PathBuf,
        destination: PathBuf,
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    match Cli::parse().command {
        Command::Pack { source, output } => {
            let report = pack_artifact(&source, &output)?;
            println!(
                "packed {} objects ({} bytes) to {}",
                report.object_count,
                report.byte_count,
                output.display()
            );
        }
        Command::Unpack {
            artifact,
            destination,
        } => {
            let report = unpack_artifact(&artifact, &destination)?;
            println!(
                "unpacked {} objects ({} bytes) to {}",
                report.object_count,
                report.byte_count,
                destination.display()
            );
        }
        Command::Verify { artifact } => {
            let report = if is_packed(&artifact) {
                verify_packed(&artifact)?
            } else {
                verify_artifact(&artifact)?
            };
            println!(
                "verified {} objects ({} bytes)",
                report.object_count, report.byte_count
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
    Ok(())
}

fn manifest_bytes(path: &Path) -> anyhow::Result<Vec<u8>> {
    if is_packed(path) {
        return Ok(read_packed_manifest(path)?);
    }
    let (manifest_path, _) = locate_artifact(path);
    fs::read(&manifest_path).with_context(|| format!("read {}", manifest_path.display()))
}

fn is_packed(path: &Path) -> bool {
    let mut magic = [0; 8];
    fs::File::open(path).is_ok_and(|mut file| file.read_exact(&mut magic).is_ok())
        && &magic == b"BFPLOT\0\0"
}

#[derive(Clone)]
struct ServeState {
    manifest: Arc<Vec<u8>>,
    document: Arc<Vec<u8>>,
    objects: ObjectStore,
    viewer: Viewer,
    _unpacked: Option<Arc<tempfile::TempDir>>,
}

/// A verified result directory; a packed file is first unpacked into a temporary one.
struct ServeArtifact {
    manifest: Vec<u8>,
    manifest_data: Manifest,
    document: Document,
    objects: ObjectStore,
    unpacked: Option<Arc<tempfile::TempDir>>,
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
    let state = ServeState {
        manifest: Arc::new(artifact.manifest),
        document: Arc::new(viewer_document_bytes),
        objects: artifact.objects,
        viewer,
        _unpacked: artifact.unpacked,
    };
    let app = Router::new()
        .route("/", get(index))
        .route("/manifest", get(manifest))
        .route("/document", get(document))
        .route("/objects/sha256/{digest}", get(object))
        .route("/viewer/{*path}", get(viewer_asset))
        .with_state(state);
    let address = (bind, port);
    let listener = tokio::net::TcpListener::bind(address).await?;
    let url = format!("http://{}", listener.local_addr()?);
    eprintln!("serving {url}");
    if open_browser {
        open_default_browser(&url)?;
    }
    axum::serve(listener, app).await?;
    Ok(())
}

fn prepare_serve_artifact(path: &Path) -> anyhow::Result<ServeArtifact> {
    let mut unpacked = None;
    let mut path = path.to_path_buf();
    if is_packed(&path) {
        let directory = tempfile::tempdir().context("create a directory to unpack into")?;
        let result = directory.path().join("result.bfplot");
        unpack_artifact(&path, &result)?;
        unpacked = Some(Arc::new(directory));
        path = result;
    } else {
        verify_artifact(&path)?;
    }
    let artifact = load_artifact(&path)?;
    Ok(ServeArtifact {
        manifest: manifest_bytes(&path)?,
        manifest_data: artifact.manifest,
        document: artifact.document,
        objects: artifact.store,
        unpacked,
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
    let id = match format!("sha256:{digest}").parse() {
        Ok(id) => id,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    match state.objects.get(&id) {
        Ok(bytes) => bytes_response(bytes, "application/octet-stream"),
        Err(bfplot_core::Error::ObjectNotFound(_)) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::UNPROCESSABLE_ENTITY.into_response(),
    }
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
        for (key, value) in &figure.metadata {
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
            for (key, value) in &axes.metadata {
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
        "metadata": {
            "result": {"document": manifest.document.to_string()},
            "provenance": manifest.provenance,
        },
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
        let mut manifest = Manifest::new(ObjectId::of(b"document"));
        manifest.provenance.insert(
            "created_utc".into(),
            serde_json::json!("2026-01-01T00:00:00Z"),
        );
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
        assert_eq!(
            value["metadata"]["provenance"]["created_utc"],
            "2026-01-01T00:00:00Z"
        );
    }

    #[test]
    fn prepares_directory_and_packed_results_for_the_server() {
        let directory = tempfile::tempdir().unwrap();
        let result = directory.path().join("fit.bfplot");
        let store = ObjectStore::for_result_dir(&result);
        let mut document = Document::default();
        document.figures.push(bfplot_core::Figure {
            id: "figure".into(),
            axes: Vec::new(),
            metadata: [("name".to_string(), serde_json::json!("spectrum"))].into(),
        });
        let document_id = store.put_json(&document).unwrap();
        let manifest_text = toml::to_string(&Manifest::new(document_id.clone())).unwrap();
        fs::write(result.join("manifest.toml"), &manifest_text).unwrap();
        fs::write(result.join(".gitignore"), "/objects/\n").unwrap();
        // Packed files are recognised by their magic, not their name.
        let packed_path = directory.path().join("portable.bin");
        pack_artifact(&result, &packed_path).unwrap();

        for source in [&result, &result.join("manifest.toml"), &packed_path] {
            let served = prepare_serve_artifact(source).unwrap();
            assert_eq!(served.manifest, manifest_text.as_bytes());
            assert_eq!(served.document.figures[0].metadata["name"], "spectrum");
            assert!(served.objects.get(&document_id).is_ok());
            assert_eq!(manifest_bytes(source).unwrap(), manifest_text.as_bytes());
            let value: serde_json::Value = serde_json::from_slice(
                &viewer_document(&served.document, &served.manifest_data).unwrap(),
            )
            .unwrap();
            assert_eq!(value["figures"][0]["name"], "spectrum");
        }
    }

    fn serve_state(viewer: Viewer) -> ServeState {
        let directory = tempfile::tempdir().unwrap();
        let result = directory.path().join("fit.bfplot");
        let id = ObjectStore::for_result_dir(&result)
            .put_json(&Document::default())
            .unwrap();
        let manifest = toml::to_string(&Manifest::new(id)).unwrap();
        fs::write(result.join("manifest.toml"), &manifest).unwrap();
        fs::write(result.join(".gitignore"), "/objects/\n").unwrap();
        let artifact = prepare_serve_artifact(&result).unwrap();
        ServeState {
            manifest: Arc::new(artifact.manifest),
            document: Arc::new(Vec::new()),
            objects: artifact.objects,
            viewer,
            _unpacked: Some(Arc::new(directory)),
        }
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
        let state = serve_state(Viewer::new(None).unwrap());

        let (status, content_type, page) = body(index(State(state.clone())).await).await;
        let page = String::from_utf8(page).unwrap();
        assert_eq!(status, StatusCode::OK);
        assert!(content_type.starts_with("text/html"));
        assert!(page.contains("src=\"/viewer/app.js\""));
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
        let state = serve_state(Viewer::new(Some(viewer.path().to_path_buf())).unwrap());

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
            vec!["bfplot", "pack", "in.bfplot", "out-file.bfplot"],
            vec!["bfplot", "unpack", "in.bfplot", "restored.bfplot"],
            vec!["bfplot", "manifest", "in.bfplot"],
            vec!["bfplot", "verify", "in.bfplot"],
            vec!["bfplot", "view", "in.bfplot"],
            vec!["bfplot", "serve", "in.bfplot", "--port", "9000"],
        ] {
            assert!(Cli::try_parse_from(arguments).is_ok());
        }
    }
}
