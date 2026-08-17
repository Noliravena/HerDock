use std::{sync::RwLock, time::Duration};

use anyhow::{Context, Result};
use reqwest::Client;

static CONFIGURED_PROXY: RwLock<String> = RwLock::new(String::new());

pub fn set_configured_proxy(proxy: impl Into<String>) {
    if let Ok(mut slot) = CONFIGURED_PROXY.write() {
        *slot = proxy.into().trim().to_string();
    }
}

pub fn configured_proxy() -> String {
    CONFIGURED_PROXY
        .read()
        .map(|value| value.clone())
        .unwrap_or_default()
}

pub fn env_proxy() -> String {
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    String::new()
}

pub fn resolve_proxy(settings_proxy: &str, env_proxy: &str) -> Option<String> {
    [settings_proxy, env_proxy]
        .into_iter()
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub fn resolved_proxy() -> Option<String> {
    resolve_proxy(&configured_proxy(), &env_proxy())
}

pub fn display_proxy(proxy: &str) -> String {
    let Ok(parsed) = reqwest::Url::parse(proxy) else {
        return proxy.to_string();
    };
    if parsed.username().is_empty() {
        return proxy.to_string();
    }
    let host = parsed.host_str().unwrap_or_default();
    let port = parsed
        .port()
        .map(|value| format!(":{value}"))
        .unwrap_or_default();
    format!("{}://***@{host}{port}", parsed.scheme())
}

pub fn build_client(connect: Duration, timeout: Duration) -> Result<Client> {
    let mut builder = Client::builder().connect_timeout(connect).timeout(timeout);
    if let Some(proxy) = resolved_proxy() {
        builder = builder.proxy(
            reqwest::Proxy::all(&proxy).with_context(|| format!("invalid HTTP proxy: {proxy}"))?,
        );
    }
    builder.build().context("build HTTP client")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_proxy_wins_over_env() {
        assert_eq!(
            resolve_proxy("http://127.0.0.1:7890", "http://env:8080").as_deref(),
            Some("http://127.0.0.1:7890")
        );
    }

    #[test]
    fn empty_settings_falls_back_to_env() {
        assert_eq!(
            resolve_proxy("  ", "http://env:8080").as_deref(),
            Some("http://env:8080")
        );
    }

    #[test]
    fn blank_proxy_is_none() {
        assert_eq!(resolve_proxy("", ""), None);
    }

    #[test]
    fn redacts_proxy_userinfo() {
        assert_eq!(
            display_proxy("http://alice:secret@10.0.0.1:8080"),
            "http://***@10.0.0.1:8080"
        );
    }
}
