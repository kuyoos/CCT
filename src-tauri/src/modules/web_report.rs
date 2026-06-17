//! Codex-only local report service.

use serde::Serialize;
use std::sync::{OnceLock, RwLock};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{timeout, Duration};
use url::Url;

use super::config::PORT_RANGE;

const MAX_HTTP_REQUEST_BYTES: usize = 32 * 1024;
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(5);

static ACTUAL_REPORT_PORT: OnceLock<RwLock<Option<u16>>> = OnceLock::new();

#[derive(Debug, Clone, Copy)]
enum ReportFormat {
    Markdown,
    Yaml,
}

#[derive(Debug, Clone, Serialize)]
struct ReportRow {
    service: String,
    account: String,
    metric: String,
    used: String,
    remaining: String,
    reset_cycle: String,
    status: String,
    note: String,
}

fn report_port_state() -> &'static RwLock<Option<u16>> {
    ACTUAL_REPORT_PORT.get_or_init(|| RwLock::new(None))
}

fn set_actual_port(port: Option<u16>) {
    if let Ok(mut guard) = report_port_state().write() {
        *guard = port;
    }
}

pub fn get_actual_port() -> Option<u16> {
    report_port_state().read().ok().and_then(|guard| *guard)
}

fn http_response(status: &str, content_type: &str, body: String) -> Vec<u8> {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    )
    .into_bytes()
}

fn unauthorized_response() -> Vec<u8> {
    http_response("401 Unauthorized", "text/plain", "Unauthorized".to_string())
}

fn not_found_response() -> Vec<u8> {
    http_response("404 Not Found", "text/plain", "Not Found".to_string())
}

fn detect_report_format(path: &str, query: &Url) -> ReportFormat {
    let format = query
        .query_pairs()
        .find(|(key, _)| key == "format")
        .map(|(_, value)| value.to_string())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if path.ends_with(".yaml") || path.ends_with(".yml") || format == "yaml" || format == "yml" {
        ReportFormat::Yaml
    } else {
        ReportFormat::Markdown
    }
}

fn render_yaml(rows: &[ReportRow]) -> String {
    let mut output = String::from("services:\n");
    for row in rows {
        output.push_str(&format!(
            "  - service: {}\n    account: {}\n    metric: {}\n    used: {}\n    remaining: {}\n    reset_cycle: {}\n    status: {}\n    note: {}\n",
            row.service,
            row.account,
            row.metric,
            row.used,
            row.remaining,
            row.reset_cycle,
            row.status,
            row.note
        ));
    }
    output
}

fn render_markdown(rows: &[ReportRow]) -> String {
    let mut output = String::from("# Codex Report\n\n");
    output.push_str("| Service | Account | Metric | Used | Remaining | Reset Cycle | Status | Note |\n");
    output.push_str("| --- | --- | --- | --- | --- | --- | --- | --- |\n");
    for row in rows {
        output.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} | {} |\n",
            row.service,
            row.account,
            row.metric,
            row.used,
            row.remaining,
            row.reset_cycle,
            row.status,
            row.note
        ));
    }
    output
}

async fn collect_codex_rows() -> Vec<ReportRow> {
    let index = super::codex_account::load_account_index();
    index
        .accounts
        .into_iter()
        .map(|account| ReportRow {
            service: "codex".to_string(),
            account: account.email,
            metric: "quota".to_string(),
            used: "-".to_string(),
            remaining: "-".to_string(),
            reset_cycle: "-".to_string(),
            status: "available".to_string(),
            note: account.id,
        })
        .collect()
}

async fn handle_connection(mut stream: TcpStream) -> Result<(), String> {
    let mut buffer = vec![0u8; MAX_HTTP_REQUEST_BYTES];
    let read_bytes = timeout(REQUEST_READ_TIMEOUT, stream.read(&mut buffer))
        .await
        .map_err(|_| "读取请求超时".to_string())?
        .map_err(|err| format!("读取请求失败: {}", err))?;
    if read_bytes == 0 {
        return Ok(());
    }

    let request = String::from_utf8_lossy(&buffer[..read_bytes]);
    let request_line = request.lines().next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();

    if method != "GET" {
        let response = http_response("405 Method Not Allowed", "text/plain", "Method Not Allowed".to_string());
        stream.write_all(&response).await.map_err(|err| err.to_string())?;
        return Ok(());
    }

    let url = Url::parse(&format!("http://127.0.0.1{}", target))
        .map_err(|err| format!("解析请求失败: {}", err))?;
    let path = url.path();
    if path != "/report" && path != "/report.md" && path != "/report.yaml" && path != "/report.yml" {
        let response = not_found_response();
        stream.write_all(&response).await.map_err(|err| err.to_string())?;
        return Ok(());
    }

    let config = super::config::get_user_config();
    let token = url
        .query_pairs()
        .find(|(key, _)| key == "token")
        .map(|(_, value)| value.to_string())
        .unwrap_or_default();
    if !config.report_token.trim().is_empty() && token != config.report_token {
        let response = unauthorized_response();
        stream.write_all(&response).await.map_err(|err| err.to_string())?;
        return Ok(());
    }

    let rows = collect_codex_rows().await;
    let format = detect_report_format(path, &url);
    let (content_type, body) = match format {
        ReportFormat::Yaml => ("application/yaml", render_yaml(&rows)),
        ReportFormat::Markdown => ("text/markdown", render_markdown(&rows)),
    };
    let response = http_response("200 OK", content_type, body);
    stream.write_all(&response).await.map_err(|err| err.to_string())?;
    Ok(())
}

pub async fn start_server() {
    let config = super::config::get_user_config();
    if !config.report_enabled {
        set_actual_port(None);
        return;
    }

    let start_port = config.report_port;
    for offset in 0..PORT_RANGE {
        let Some(port) = start_port.checked_add(offset) else {
            break;
        };
        match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => {
                set_actual_port(Some(port));
                super::logger::log_info(&format!("[WebReport] Codex report service listening on {}", port));
                loop {
                    match listener.accept().await {
                        Ok((stream, _)) => {
                            tokio::spawn(async move {
                                if let Err(err) = handle_connection(stream).await {
                                    super::logger::log_warn(&format!("[WebReport] 请求处理失败: {}", err));
                                }
                            });
                        }
                        Err(err) => {
                            super::logger::log_warn(&format!("[WebReport] 接收连接失败: {}", err));
                        }
                    }
                }
            }
            Err(_) => continue,
        }
    }

    set_actual_port(None);
    super::logger::log_error("[WebReport] 无法启动 Codex report service");
}