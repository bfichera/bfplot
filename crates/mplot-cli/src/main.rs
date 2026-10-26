use std::{
    fs,
    io::{self, BufReader, BufWriter, Write},
    net::IpAddr,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, bail};
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
        } => serve(artifact, bind, port).await?,
        Command::Stream { command } => stream(command)?,
    }
    Ok(())
}

fn is_packed(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension == "mplot")
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
}

async fn serve(path: PathBuf, bind: IpAddr, port: u16) -> anyhow::Result<()> {
    if is_packed(&path) {
        bail!("serve currently requires a split *.mplot.toml artifact; unpack it first");
    }
    verify_artifact(&path)?;
    let artifact = load_artifact(&path)?;
    let state = ServeState {
        manifest: Arc::new(fs::read(&path).with_context(|| format!("read {}", path.display()))?),
        document: Arc::new(artifact.store.get(&artifact.manifest.document)?),
        objects: artifact.store,
    };
    let app = Router::new()
        .route("/", get(index))
        .route("/manifest", get(manifest))
        .route("/document", get(document))
        .route("/objects/sha256/{digest}", get(object))
        .with_state(state);
    let address = (bind, port);
    let listener = tokio::net::TcpListener::bind(address).await?;
    eprintln!("serving http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn index() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        "<!doctype html><title>MPlot</title><h1>MPlot artifact</h1><ul><li><a href='/manifest'>manifest</a></li><li><a href='/document'>document</a></li></ul>",
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
    fn all_required_commands_parse() {
        for arguments in [
            vec!["mplot", "pack", "in.mplot.toml", "out.mplot"],
            vec!["mplot", "unpack", "in.mplot", "out.mplot.toml"],
            vec!["mplot", "verify", "in.mplot"],
            vec!["mplot", "stream", "encode"],
            vec!["mplot", "stream", "decode"],
        ] {
            assert!(Cli::try_parse_from(arguments).is_ok());
        }
    }
}
