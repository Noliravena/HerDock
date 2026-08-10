use std::{
    io::{Read, Write},
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{anyhow, Result};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEvent {
    pub terminal_id: String,
    pub event_type: String,
    pub data: String,
    pub exit_code: Option<u32>,
}

pub struct TerminalHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

impl TerminalHandle {
    pub fn write(&mut self, value: &str) -> Result<()> {
        self.writer.write_all(value.as_bytes())?;
        self.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn close(&mut self) -> Result<()> {
        self.child
            .lock()
            .map_err(|_| anyhow!("terminal child lock is poisoned"))?
            .kill()?;
        Ok(())
    }
}

pub fn open(
    shell: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
    channel: Channel<TerminalEvent>,
) -> Result<(String, TerminalHandle)> {
    let terminal_id = format!("term_{}", Uuid::new_v4().simple());
    let pair = native_pty_system().openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;
    let mut command = CommandBuilder::new(shell);
    command.cwd(cwd);
    if cfg!(target_os = "macos") {
        command.arg("-l");
    }
    let child = Arc::new(Mutex::new(pair.slave.spawn_command(command)?));
    drop(pair.slave);
    let writer = pair.master.take_writer()?;
    let mut reader = pair.master.try_clone_reader()?;
    let output_terminal_id = terminal_id.clone();
    let output_channel = channel.clone();
    std::thread::Builder::new()
        .name(format!("herdock-{terminal_id}"))
        .spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        let _ = output_channel.send(TerminalEvent {
                            terminal_id: output_terminal_id.clone(),
                            event_type: "output".into(),
                            data: String::from_utf8_lossy(&buffer[..read]).to_string(),
                            exit_code: None,
                        });
                    }
                    Err(_) => break,
                }
            }
        })
        .map_err(|error| anyhow!(error))?;
    let wait_terminal_id = terminal_id.clone();
    let wait_child = child.clone();
    std::thread::Builder::new()
        .name(format!("herdock-wait-{terminal_id}"))
        .spawn(move || loop {
            let status = match wait_child.lock() {
                Ok(mut child) => child.try_wait(),
                Err(_) => return,
            };
            match status {
                Ok(Some(status)) => {
                    let _ = channel.send(TerminalEvent {
                        terminal_id: wait_terminal_id,
                        event_type: "exit".into(),
                        data: String::new(),
                        exit_code: Some(status.exit_code()),
                    });
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(80)),
                Err(_) => {
                    let _ = channel.send(TerminalEvent {
                        terminal_id: wait_terminal_id,
                        event_type: "exit".into(),
                        data: String::new(),
                        exit_code: None,
                    });
                    break;
                }
            }
        })
        .map_err(|error| anyhow!(error))?;
    Ok((
        terminal_id,
        TerminalHandle {
            master: pair.master,
            writer,
            child,
        },
    ))
}
