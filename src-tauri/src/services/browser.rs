use std::{collections::HashMap, sync::Arc};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder, WebviewUrl,
};
use tokio::sync::{oneshot, Mutex};

const MAX_EVAL_RESULT_BYTES: usize = 1024 * 1024;
const EVAL_TIMEOUT_SECONDS: u64 = 15;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl BrowserBounds {
    fn normalized(self) -> Self {
        Self {
            x: self.x.max(0.0),
            y: self.y.max(0.0),
            width: self.width.max(1.0),
            height: self.height.max(1.0),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    pub id: String,
    pub url: String,
    pub title: String,
}

#[derive(Default)]
pub struct BrowserManager {
    tabs: Mutex<HashMap<String, Webview>>,
    active: Mutex<Option<String>>,
    create_lock: Mutex<()>,
}

impl BrowserManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn create(
        &self,
        app: &AppHandle,
        id: &str,
        target: &str,
        bounds: BrowserBounds,
    ) -> Result<BrowserStatus> {
        validate_id(id)?;
        let _create_guard = self.create_lock.lock().await;
        let bounds = bounds.normalized();
        if self.tabs.lock().await.contains_key(id) {
            self.show(id, bounds).await?;
            return self.status(id).await;
        }

        let url = normalize_target(target)?;
        let window = app
            .get_window("main")
            .ok_or_else(|| anyhow!("main window not found"))?;
        let label = format!("browser:{id}");
        let builder = WebviewBuilder::new(label, WebviewUrl::External(url.clone()))
            .on_navigation(|next| matches!(next.scheme(), "http" | "https"))
            .disable_drag_drop_handler();
        let webview = window.add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )?;
        self.tabs.lock().await.insert(id.to_string(), webview);
        self.show(id, bounds).await?;
        self.status(id).await
    }

    pub async fn show(&self, id: &str, bounds: BrowserBounds) -> Result<()> {
        let tabs = self.tabs.lock().await;
        let target = tabs
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("browser tab not found: {id}"))?;
        for (tab_id, webview) in tabs.iter() {
            if tab_id != id {
                let _ = webview.hide();
            }
        }
        drop(tabs);
        let bounds = bounds.normalized();
        target.set_position(LogicalPosition::new(bounds.x, bounds.y))?;
        target.set_size(LogicalSize::new(bounds.width, bounds.height))?;
        target.show()?;
        *self.active.lock().await = Some(id.to_string());
        Ok(())
    }

    pub async fn set_bounds(&self, id: &str, bounds: BrowserBounds) -> Result<()> {
        let webview = self.webview(Some(id)).await?;
        let bounds = bounds.normalized();
        webview.set_position(LogicalPosition::new(bounds.x, bounds.y))?;
        webview.set_size(LogicalSize::new(bounds.width, bounds.height))?;
        Ok(())
    }

    pub async fn hide(&self, id: &str) -> Result<()> {
        let webview = self.webview(Some(id)).await?;
        webview.hide()?;
        let mut active = self.active.lock().await;
        if active.as_deref() == Some(id) {
            *active = None;
        }
        Ok(())
    }

    pub async fn close(&self, id: &str) -> Result<()> {
        if let Some(webview) = self.tabs.lock().await.remove(id) {
            webview.close()?;
        }
        let mut active = self.active.lock().await;
        if active.as_deref() == Some(id) {
            *active = None;
        }
        Ok(())
    }

    pub async fn close_all(&self) {
        let tabs = std::mem::take(&mut *self.tabs.lock().await);
        for (_, webview) in tabs {
            let _ = webview.close();
        }
        *self.active.lock().await = None;
    }

    pub async fn navigate(&self, id: Option<&str>, target: &str) -> Result<BrowserStatus> {
        let (id, webview) = self.tab(id).await?;
        webview.navigate(normalize_target(target)?)?;
        Ok(BrowserStatus {
            id,
            url: webview.url()?.to_string(),
            title: String::new(),
        })
    }

    pub async fn search(
        &self,
        id: Option<&str>,
        query: &str,
        engine: Option<&str>,
    ) -> Result<BrowserStatus> {
        let url = search_url(engine.unwrap_or("bing"), query)?;
        self.navigate(id, url.as_str()).await
    }

    pub async fn back(&self, id: &str) -> Result<()> {
        self.webview(Some(id)).await?.eval("history.back()")?;
        Ok(())
    }

    pub async fn forward(&self, id: &str) -> Result<()> {
        self.webview(Some(id)).await?.eval("history.forward()")?;
        Ok(())
    }

    pub async fn reload(&self, id: &str) -> Result<()> {
        self.webview(Some(id)).await?.reload()?;
        Ok(())
    }

    pub async fn status(&self, id: &str) -> Result<BrowserStatus> {
        let webview = self.webview(Some(id)).await?;
        let title = self
            .eval_value(&webview, "document.title || ''")
            .await
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_default();
        Ok(BrowserStatus {
            id: id.to_string(),
            url: webview.url()?.to_string(),
            title,
        })
    }

    pub async fn list(&self) -> Vec<BrowserStatus> {
        let tabs = self.tabs.lock().await;
        tabs.iter()
            .map(|(id, webview)| BrowserStatus {
                id: id.clone(),
                url: webview.url().map(|url| url.to_string()).unwrap_or_default(),
                title: String::new(),
            })
            .collect()
    }

    pub async fn snapshot(&self, id: Option<&str>, max_chars: usize) -> Result<Value> {
        let (_, webview) = self.tab(id).await?;
        let script = SNAPSHOT_SCRIPT.replace(
            "__MAX_CHARS__",
            &max_chars.clamp(1_000, 200_000).to_string(),
        );
        self.eval_value(&webview, script).await
    }

    pub async fn click(
        &self,
        id: Option<&str>,
        selector: Option<&str>,
        text: Option<&str>,
        index: usize,
    ) -> Result<Value> {
        if selector.is_none() && text.is_none() {
            return Err(anyhow!("browser_click requires selector or text"));
        }
        let (_, webview) = self.tab(id).await?;
        let script = CLICK_SCRIPT
            .replace("__SELECTOR__", &serde_json::to_string(&selector)?)
            .replace("__TEXT__", &serde_json::to_string(&text)?)
            .replace("__INDEX__", &index.min(500).to_string());
        self.eval_value(&webview, script).await
    }

    pub async fn type_text(
        &self,
        id: Option<&str>,
        selector: &str,
        text: &str,
        submit: bool,
    ) -> Result<Value> {
        let (_, webview) = self.tab(id).await?;
        let script = TYPE_SCRIPT
            .replace("__SELECTOR__", &serde_json::to_string(selector)?)
            .replace("__TEXT__", &serde_json::to_string(text)?)
            .replace("__SUBMIT__", if submit { "true" } else { "false" });
        self.eval_value(&webview, script).await
    }

    async fn webview(&self, id: Option<&str>) -> Result<Webview> {
        self.tab(id).await.map(|(_, webview)| webview)
    }

    async fn tab(&self, id: Option<&str>) -> Result<(String, Webview)> {
        let selected = match id {
            Some(value) => value.to_string(),
            None => {
                if let Some(active) = self.active.lock().await.clone() {
                    active
                } else {
                    self.tabs
                        .lock()
                        .await
                        .keys()
                        .next()
                        .cloned()
                        .ok_or_else(|| anyhow!("no browser tab is open"))?
                }
            }
        };
        let webview = self
            .tabs
            .lock()
            .await
            .get(&selected)
            .cloned()
            .ok_or_else(|| anyhow!("browser tab not found: {selected}"))?;
        Ok((selected, webview))
    }

    async fn eval_value(&self, webview: &Webview, script: impl Into<String>) -> Result<Value> {
        let (sender, receiver) = oneshot::channel();
        let sender = Arc::new(std::sync::Mutex::new(Some(sender)));
        webview.eval_with_callback(script.into(), move |raw| {
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(raw);
                }
            }
        })?;
        let raw = tokio::time::timeout(
            std::time::Duration::from_secs(EVAL_TIMEOUT_SECONDS),
            receiver,
        )
        .await
        .context("browser script timed out")?
        .context("browser script callback closed")?;
        if raw.len() > MAX_EVAL_RESULT_BYTES {
            return Err(anyhow!("browser result exceeded 1 MiB"));
        }
        decode_eval_result(&raw)
    }
}

fn validate_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(anyhow!("invalid browser tab id"));
    }
    Ok(())
}

pub fn normalize_target(target: &str) -> Result<Url> {
    let value = target.trim();
    if value.is_empty() {
        return Err(anyhow!("browser target is empty"));
    }
    let candidate = if value.starts_with("http://") || value.starts_with("https://") {
        value.to_string()
    } else if value.starts_with("localhost")
        || value.starts_with("127.0.0.1")
        || value.starts_with("[::1]")
    {
        format!("http://{value}")
    } else if !value.chars().any(char::is_whitespace)
        && (value.contains('.') || value.contains(':'))
    {
        format!("https://{value}")
    } else {
        return search_url("bing", value);
    };
    let url = Url::parse(&candidate).context("invalid browser URL")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(anyhow!("only http and https browser URLs are allowed"));
    }
    Ok(url)
}

pub fn search_url(engine: &str, query: &str) -> Result<Url> {
    let (base, key) = match engine {
        "google" => ("https://www.google.com/search", "q"),
        "duckduckgo" | "ddg" => ("https://duckduckgo.com/", "q"),
        _ => ("https://www.bing.com/search", "q"),
    };
    let mut url = Url::parse(base)?;
    url.query_pairs_mut().append_pair(key, query.trim());
    Ok(url)
}

fn decode_eval_result(raw: &str) -> Result<Value> {
    let value: Value = serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.into()));
    if let Value::String(inner) = &value {
        if let Ok(nested) = serde_json::from_str(inner) {
            return Ok(nested);
        }
    }
    Ok(value)
}

const SNAPSHOT_SCRIPT: &str = r#"
(() => {
  try {
    const maxChars = __MAX_CHARS__;
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const selectorFor = el => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      for (const attr of ['data-testid', 'data-test', 'name', 'aria-label']) {
        const value = el.getAttribute(attr);
        if (value) return `${el.tagName.toLowerCase()}[${attr}=${JSON.stringify(value)}]`;
      }
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 5) {
        let part = node.tagName.toLowerCase();
        const siblings = node.parentElement ? [...node.parentElement.children].filter(child => child.tagName === node.tagName) : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        parts.unshift(part);
        const candidate = parts.join(' > ');
        if (document.querySelectorAll(candidate).length === 1) return candidate;
        node = node.parentElement;
      }
      return parts.join(' > ');
    };
    const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role=button],[role=link],[contenteditable=true]')]
      .filter(visible)
      .slice(0, 300)
      .map((el, index) => ({
        index,
        selector: selectorFor(el),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        text: clean(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title')).slice(0, 300),
        name: el.getAttribute('name') || '',
        type: el.getAttribute('type') || '',
        placeholder: el.getAttribute('placeholder') || '',
        href: el.href || '',
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true')
      }));
    return {
      ok: true,
      url: location.href,
      title: document.title,
      text: clean(document.body?.innerText || '').slice(0, maxChars),
      interactive: nodes
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
})()
"#;

const CLICK_SCRIPT: &str = r#"
(() => {
  try {
    const selector = __SELECTOR__;
    const wantedText = __TEXT__;
    const index = __INDEX__;
    let elements = selector ? [...document.querySelectorAll(selector)] : [];
    if (!elements.length && wantedText) {
      const target = String(wantedText).replace(/\s+/g, ' ').trim().toLowerCase();
      elements = [...document.querySelectorAll('a,button,[role=button],[role=link],input[type=submit],input[type=button]')]
        .filter(el => String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase().includes(target));
    }
    const el = elements[index];
    if (!el) return { ok: false, error: 'element not found', selector, text: wantedText, matches: elements.length };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus();
    el.click();
    return { ok: true, tag: el.tagName.toLowerCase(), text: String(el.innerText || el.value || '').trim().slice(0, 300), url: location.href };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
})()
"#;

const TYPE_SCRIPT: &str = r#"
(() => {
  try {
    const selector = __SELECTOR__;
    const text = __TEXT__;
    const submit = __SUBMIT__;
    const el = document.querySelector(selector);
    if (!el) return { ok: false, error: 'element not found', selector };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
    } else if (el.isContentEditable) {
      el.textContent = text;
    } else {
      return { ok: false, error: 'element is not editable', selector };
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (submit) {
      if (el.form?.requestSubmit) el.form.requestSubmit();
      else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    return { ok: true, selector, submitted: submit, url: location.href };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
})()
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_urls_and_searches_without_allowing_script_schemes() {
        assert_eq!(
            normalize_target("example.com").unwrap().as_str(),
            "https://example.com/"
        );
        assert_eq!(
            normalize_target("localhost:1420").unwrap().as_str(),
            "http://localhost:1420/"
        );
        assert!(normalize_target("javascript:alert(1)").is_err());
        assert!(search_url("bing", "rust tauri")
            .unwrap()
            .as_str()
            .contains("rust+tauri"));
    }

    #[test]
    fn validates_browser_labels_and_decodes_eval_values() {
        assert!(validate_id("browser_123").is_ok());
        assert!(validate_id("../browser").is_err());
        assert_eq!(
            decode_eval_result(r#"{"ok":true}"#).unwrap(),
            serde_json::json!({"ok": true})
        );
        assert_eq!(
            decode_eval_result(r#""{\"ok\":true}""#).unwrap(),
            serde_json::json!({"ok": true})
        );
    }
}
