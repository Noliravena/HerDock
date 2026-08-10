use std::process::Stdio;

use tokio::process::{Child, Command};

pub fn configure_child(command: &mut Command) {
    command.kill_on_drop(true);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }
}

pub async fn terminate_process_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await;
        }
        #[cfg(unix)]
        {
            let _ = Command::new("kill")
                .args(["-TERM", &format!("-{pid}")])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await;
        }
    }
    if tokio::time::timeout(std::time::Duration::from_secs(3), child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
    }
}
