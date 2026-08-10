use chrono::{DateTime, Datelike, Duration, Timelike, Utc};

use crate::domain::models::Schedule;

pub fn roll_forward_missed(schedule: &mut Schedule, now: DateTime<Utc>) -> bool {
    let missed = schedule
        .next_run_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|value| value.to_utc() <= now);
    if missed {
        schedule.next_run_at = next_run(&schedule.cron, now).map(|value| value.to_rfc3339());
        schedule.updated_at = now.to_rfc3339();
    }
    missed
}

pub fn next_run(expression: &str, from: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let fields = expression.split_whitespace().collect::<Vec<_>>();
    if fields.len() != 5 {
        return None;
    }
    let mut value = from.with_second(0)?.with_nanosecond(0)? + Duration::minutes(1);
    for _ in 0..366 * 24 * 60 {
        if field_matches(fields[0], value.minute())
            && field_matches(fields[1], value.hour())
            && field_matches(fields[2], value.day())
            && field_matches(fields[3], value.month())
            && field_matches(fields[4], value.weekday().num_days_from_sunday())
        {
            return Some(value);
        }
        value += Duration::minutes(1);
    }
    None
}

fn field_matches(field: &str, value: u32) -> bool {
    if matches!(field, "*" | "?") {
        return true;
    }
    field.split(',').any(|part| {
        let (base, step) = part
            .split_once('/')
            .map(|(base, step)| (base, step.parse::<u32>().unwrap_or(1).max(1)))
            .unwrap_or((part, 1));
        if base == "*" {
            return value % step == 0;
        }
        if let Some((low, high)) = base.split_once('-') {
            let low = low.parse::<u32>().unwrap_or(u32::MAX);
            let high = high.parse::<u32>().unwrap_or_default();
            return value >= low && value <= high && (value - low) % step == 0;
        }
        base.parse::<u32>().is_ok_and(|number| number == value)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_next_daily_run() {
        let from = DateTime::parse_from_rfc3339("2026-08-10T06:30:00Z")
            .unwrap()
            .to_utc();
        assert_eq!(
            next_run("0 7 * * *", from).unwrap().to_rfc3339(),
            "2026-08-10T07:00:00+00:00"
        );
    }

    #[test]
    fn missed_schedule_is_rolled_forward_without_catch_up() {
        let now = DateTime::parse_from_rfc3339("2026-08-10T08:00:00Z")
            .unwrap()
            .to_utc();
        let mut schedule = Schedule {
            id: "schedule_test".into(),
            workspace_id: "ws".into(),
            name: "daily".into(),
            cron: "0 7 * * *".into(),
            prompt: "test".into(),
            provider_id: "codex".into(),
            enabled: true,
            next_run_at: Some("2026-08-09T07:00:00Z".into()),
            last_run_at: None,
            created_at: now.to_rfc3339(),
            updated_at: now.to_rfc3339(),
        };
        assert!(roll_forward_missed(&mut schedule, now));
        assert_eq!(
            schedule.next_run_at.as_deref(),
            Some("2026-08-11T07:00:00+00:00")
        );
        assert!(schedule.last_run_at.is_none());
    }
}
