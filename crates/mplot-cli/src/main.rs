use std::{
    fs,
    io::{self, BufReader, BufWriter, Write},
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
use clap::{Parser, Subcommand};
use mplot_core::{
    PackLimits, StreamFrame, StreamReader, StreamWriter, load_artifact, pack_artifact,
    unpack_artifact, verify_artifact, verify_packed,
};

#[derive(Parser)]
#[command(version, about = "Pack, validate, serve, and stream MPlot artifacts")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Pack a split manifest and its referenced objects.
    Pack { manifest: PathBuf, output: PathBuf },
    /// Unpack an artifact into a split manifest and object store.
    Unpack {
        artifact: PathBuf,
        manifest: PathBuf,
    },
    /// Verify hashes, schema, and referenced objects.
    Verify { artifact: PathBuf },
    /// Serve an artifact over HTTP (loopback by default).
    Serve {
        artifact: PathBuf,
        #[arg(long, default_value = "127.0.0.1")]
        bind: IpAddr,
        #[arg(long, default_value_t = 8080)]
        port: u16,
        /// Directory containing the built viewer's index.js and style.css.
        #[arg(long)]
        viewer_dir: Option<PathBuf>,
    },
    /// Serve an artifact and open it in the default browser.
    View {
        artifact: PathBuf,
        #[arg(long, default_value = "127.0.0.1")]
        bind: IpAddr,
        #[arg(long, default_value_t = 8080)]
        port: u16,
        #[arg(long)]
        viewer_dir: Option<PathBuf>,
    },
    /// Encode/decode newline JSON stream frames.
    Stream {
        #[command(subcommand)]
        command: StreamCommand,
    },
}

#[derive(Subcommand)]
enum StreamCommand {
    /// Convert newline-delimited JSON frames from stdin to binary stream on stdout.
    Encode,
    /// Convert a binary stream from stdin to newline-delimited JSON on stdout.
    Decode,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_writer(io::stderr)
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    match Cli::parse().command {
        Command::Pack { manifest, output } => {
            let report = pack_artifact(&manifest, &output)?;
            println!(
                "packed {} objects ({} bytes) to {}",
                report.object_count,
                report.byte_count,
                output.display()
            );
        }
        Command::Unpack { artifact, manifest } => {
            let report = unpack_artifact(&artifact, &manifest, PackLimits::default())?;
            println!(
                "unpacked {} objects ({} bytes) to {}",
                report.object_count,
                report.byte_count,
                manifest.display()
            );
        }
        Command::Verify { artifact } => {
            let report = if is_packed(&artifact) {
                verify_packed(&artifact, PackLimits::default())?
            } else {
                verify_artifact(&artifact)?
            };
            println!(
                "verified {} objects ({} bytes)",
                report.object_count, report.byte_count
            );
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
        Command::Stream { command } => stream(command)?,
    }
    Ok(())
}

fn is_packed(path: &Path) -> bool {
    const MAGIC: &[u8; 8] = b"MPLOT\0\x09\x09";
    fs::File::open(path)
        .and_then(|file| {
            use std::io::Read;
            let mut magic = [0; 8];
            file.take(8).read_exact(&mut magic).map(|_| magic)
        })
        .is_ok_and(|magic| &magic == MAGIC)
}

fn stream(command: StreamCommand) -> anyhow::Result<()> {
    match command {
        StreamCommand::Encode => {
            let stdin = io::stdin();
            let mut writer = StreamWriter::new(BufWriter::new(io::stdout().lock()))?;
            let deserializer = serde_json::Deserializer::from_reader(BufReader::new(stdin.lock()))
                .into_iter::<StreamFrame>();
            for frame in deserializer {
                writer.write_frame(&frame?)?;
            }
        }
        StreamCommand::Decode => {
            let stdin = io::stdin();
            let mut reader = StreamReader::new(BufReader::new(stdin.lock()))?;
            let mut stdout = BufWriter::new(io::stdout().lock());
            while let Some(frame) = reader.read_frame()? {
                serde_json::to_writer(&mut stdout, &frame)?;
                writeln!(stdout)?;
                if frame == StreamFrame::End {
                    break;
                }
            }
        }
    }
    Ok(())
}

#[derive(Clone)]
struct ServeState {
    manifest: Arc<Vec<u8>>,
    document: Arc<Vec<u8>>,
    objects: mplot_core::ObjectStore,
    viewer_dir: Option<PathBuf>,
    _packed_extraction: Option<Arc<tempfile::TempDir>>,
}

struct ServeArtifact {
    manifest: Vec<u8>,
    document: mplot_core::Document,
    objects: mplot_core::ObjectStore,
    packed_extraction: Option<Arc<tempfile::TempDir>>,
}

async fn serve(
    path: PathBuf,
    bind: IpAddr,
    port: u16,
    viewer_dir: Option<PathBuf>,
    open_browser: bool,
) -> anyhow::Result<()> {
    let artifact = prepare_serve_artifact(&path)?;
    let viewer_document_bytes = viewer_document(&artifact.document)?;
    let viewer_dir = discover_viewer_dir(viewer_dir);
    if viewer_dir.is_none() {
        eprintln!(
            "warning: viewer assets not found; set --viewer-dir or MPLOT_VIEWER_DIR (artifact APIs remain available)"
        );
    }
    let state = ServeState {
        manifest: Arc::new(artifact.manifest),
        document: Arc::new(viewer_document_bytes),
        objects: artifact.objects,
        viewer_dir,
        _packed_extraction: artifact.packed_extraction,
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
    if is_packed(path) {
        verify_packed(path, PackLimits::default())?;
        let extraction = Arc::new(tempfile::tempdir().context("create packed artifact workspace")?);
        let manifest_path = extraction.path().join("artifact.mplot.toml");
        unpack_artifact(path, &manifest_path, PackLimits::default())?;
        let artifact = load_artifact(&manifest_path)?;
        return Ok(ServeArtifact {
            manifest: fs::read(&manifest_path)
                .with_context(|| format!("read {}", manifest_path.display()))?,
            document: artifact.document,
            objects: artifact.store,
            packed_extraction: Some(extraction),
        });
    }

    verify_artifact(path)?;
    let artifact = load_artifact(path)?;
    Ok(ServeArtifact {
        manifest: fs::read(path).with_context(|| format!("read {}", path.display()))?,
        document: artifact.document,
        objects: artifact.store,
        packed_extraction: None,
    })
}

async fn index(State(state): State<ServeState>) -> Response {
    let Some(viewer_dir) = state.viewer_dir else {
        return bytes_response(
            b"<!doctype html><title>MPlot</title><h1>MPlot artifact</h1><p>Viewer assets are unavailable.</p><ul><li><a href='/manifest'>manifest</a></li><li><a href='/document'>document</a></li></ul>".to_vec(),
            "text/html; charset=utf-8",
        );
    };
    if let Ok(index) = fs::read_to_string(viewer_dir.join("index.html")) {
        return bytes_response(
            index.replace("\"./", "\"/viewer/").into_bytes(),
            "text/html; charset=utf-8",
        );
    }
    bytes_response(
        br#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MPlot</title><link rel="stylesheet" href="/viewer/style.css"></head><body><div id="mplot"></div><script type="module">import {createViewer} from '/viewer/index.js'; const document=await fetch('/document').then(r=>r.json()); createViewer('#mplot',document);</script></body></html>"#.to_vec(),
        "text/html; charset=utf-8",
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
    let id = match format!("sha256:{digest}").parse() {
        Ok(id) => id,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    match state.objects.get(&id) {
        Ok(bytes) => bytes_response(bytes, "application/octet-stream"),
        Err(mplot_core::Error::ObjectNotFound(_)) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::UNPROCESSABLE_ENTITY.into_response(),
    }
}

async fn viewer_asset(
    State(state): State<ServeState>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    let Some(root) = state.viewer_dir else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let relative = Path::new(&path);
    if relative
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let asset = root.join(relative);
    let bytes = match fs::read(&asset) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return StatusCode::NOT_FOUND.into_response();
        }
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let content_type = match asset.extension().and_then(|value| value.to_str()) {
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("map") | Some("json") => "application/json",
        _ => "application/octet-stream",
    };
    bytes_response(bytes, content_type)
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

fn discover_viewer_dir(explicit: Option<PathBuf>) -> Option<PathBuf> {
    explicit
        .or_else(|| std::env::var_os("MPLOT_VIEWER_DIR").map(PathBuf::from))
        .or_else(|| {
            let local = PathBuf::from("viewer/dist");
            viewer_entry_exists(&local).then_some(local)
        })
        .filter(|directory| viewer_entry_exists(directory))
}

fn viewer_entry_exists(directory: &Path) -> bool {
    directory.join("app.js").is_file() || directory.join("index.js").is_file()
}

fn viewer_document(document: &mplot_core::Document) -> anyhow::Result<Vec<u8>> {
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
        for (key, value) in &figure.props {
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
            for (key, value) in &axes.props {
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
        "schema_version": document.schema_version,
        "figures": figures,
        "axes": axes_values,
        "artists": artists,
        "links": document.links,
        "selections": document.selections,
        "metadata": document.metadata,
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
        for (source, suffix) in [("label", "label"), ("scale", "scale"), ("limits", "lim")] {
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
    use clap::Parser;
    use mplot_core::{Document, Manifest, ObjectStore};

    #[test]
    fn serve_defaults_to_loopback() {
        let cli = Cli::try_parse_from(["mplot", "serve", "plot.mplot.toml"]).unwrap();
        let Command::Serve { bind, port, .. } = cli.command else {
            panic!("expected serve command");
        };
        assert!(bind.is_loopback());
        assert_eq!(port, 8080);
    }

    #[test]
    fn flattens_python_document_for_viewer() {
        let document: mplot_core::Document = serde_json::from_str(include_str!(
            "../../mplot-core/tests/fixtures/python-document.json"
        ))
        .unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&viewer_document(&document).unwrap()).unwrap();
        assert_eq!(value["axes"][0]["xlim"], serde_json::json!([0.0, 1.0]));
        assert_eq!(
            value["axes"][0]["position"],
            serde_json::json!([0.125, 0.11, 0.775, 0.77])
        );
        assert_eq!(value["axes"][0]["projection"], "2d");
        assert_eq!(value["artists"][0]["id"], "artist-0");
        assert_eq!(value["figures"][0]["axes"][0], "figure-0-axes-0");
    }

    #[test]
    fn prepares_split_and_packed_artifacts_for_the_same_server() {
        let directory = tempfile::tempdir().unwrap();
        let manifest_path = directory.path().join("source.mplot.toml");
        let store = ObjectStore::for_manifest(&manifest_path);
        let document = Document::default();
        let document_id = store.put_json(&document).unwrap();
        fs::write(
            &manifest_path,
            toml::to_string(&Manifest::new(document_id)).unwrap(),
        )
        .unwrap();
        let packed_path = directory.path().join("source.mplot");
        pack_artifact(&manifest_path, &packed_path).unwrap();
        let disguised_packed_path = directory.path().join("portable-artifact.bin");
        fs::copy(&packed_path, &disguised_packed_path).unwrap();

        let split = prepare_serve_artifact(&manifest_path).unwrap();
        let packed = prepare_serve_artifact(&disguised_packed_path).unwrap();
        assert_eq!(
            serde_json::to_value(&split.document).unwrap(),
            serde_json::to_value(&packed.document).unwrap()
        );
        assert!(split.packed_extraction.is_none());
        assert!(packed.packed_extraction.is_some());
        assert_eq!(split.manifest, packed.manifest);
        let manifest: Manifest =
            toml::from_str(std::str::from_utf8(&split.manifest).unwrap()).unwrap();
        assert_eq!(
            split.objects.get(&manifest.document).unwrap(),
            packed.objects.get(&manifest.document).unwrap()
        );
    }

    #[test]
    fn all_required_commands_parse() {
        for arguments in [
            vec!["mplot", "pack", "in.mplot.toml", "out.mplot"],
            vec!["mplot", "unpack", "in.mplot", "out.mplot.toml"],
            vec!["mplot", "verify", "in.mplot"],
            vec!["mplot", "view", "in.mplot.toml"],
            vec!["mplot", "stream", "encode"],
            vec!["mplot", "stream", "decode"],
        ] {
            assert!(Cli::try_parse_from(arguments).is_ok());
        }
    }
}
