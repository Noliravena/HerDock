pub const MAX_LIVE_RUNS: usize = 2;

pub fn can_admit(live: usize) -> bool {
    live < MAX_LIVE_RUNS
}

pub fn busy_message(live: usize) -> String {
    format!(
        "已有 {live} 个任务在运行（最多同时 {MAX_LIVE_RUNS} 个）。先停掉一个会话，或等它结束再发。"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admits_until_cap() {
        assert!(can_admit(0));
        assert!(can_admit(1));
        assert!(!can_admit(MAX_LIVE_RUNS));
        assert!(!can_admit(MAX_LIVE_RUNS + 1));
    }
}
