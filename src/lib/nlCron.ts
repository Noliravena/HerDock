export type ParsedSchedule = {
  name: string;
  cron: string;
  prompt: string;
  summary: string;
};

const WEEKDAY_CN: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

const WEEKDAY_EN: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

export function looksLikeScheduleIntent(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 400) return false;
  if (/禁止定时|不要定时|别定时/.test(value)) return false;
  if (/每小时/.test(value) || /every\s+hour/i.test(value)) return true;
  const hasCycle =
    /每天|每日|天天|工作日|每个工作日|周一到周五|每周|every\s+day|weekdays|every\s+(mon|tue|wed|thu|fri|sat|sun)/i.test(
      value,
    );
  const hasTime = /\d+\s*点|\d{1,2}:\d{2}|\b(am|pm)\b/i.test(value);
  return hasCycle && hasTime;
}

export function parseScheduleIntent(text: string): ParsedSchedule | null {
  const raw = text.replace(/^\/(定时|schedule)\s*/i, "").trim();
  if (!raw || /禁止定时|不要定时|别定时/.test(raw)) return null;

  const hourMatch = parseTime(raw);
  if (/每小时|every\s+hour/i.test(raw)) {
    const prompt = stripScheduleWords(raw);
    return pack("0 * * * *", prompt, "每小时");
  }
  if (!hourMatch) return null;
  const { hour, minute, span } = hourMatch;

  let dow = "*";
  let summaryCycle = "每天";
  if (/工作日|每个工作日|周一到周五|weekdays/i.test(raw)) {
    dow = "1-5";
    summaryCycle = "每个工作日";
  } else if (/每周([日天一二三四五六])/.test(raw)) {
    const day = WEEKDAY_CN[RegExp.$1];
    if (day == null) return null;
    dow = String(day);
    summaryCycle = `每周${RegExp.$1}`;
  } else {
    const englishDay =
      /every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|fri|sat)\b/i.exec(
        raw,
      );
    if (englishDay) {
      const day = WEEKDAY_EN[englishDay[1].toLowerCase()];
      if (day == null) return null;
      dow = String(day);
      summaryCycle = `每周 ${englishDay[1]}`;
    }
  }

  const cron = `${minute} ${hour} * * ${dow}`;
  const prompt = stripScheduleWords(raw.replace(span, " "));
  return pack(cron, prompt, `${summaryCycle} ${pad(hour)}:${pad(minute)}`);
}

export function cronSummary(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return cron;
  const [minute, hour, , , dow] = fields;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (hour === "*" && minute === "0") return "每小时";
  if (dow === "1-5") return `工作日 ${time}`;
  if (dow === "*") return `每天 ${time}`;
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  if (/^\d$/.test(dow)) return `每周${names[Number(dow)] || dow} ${time}`;
  return `${cron} · ${time}`;
}

function parseTime(text: string): { hour: number; minute: number; span: string } | null {
  const cn =
    /(?:(早上|上午|凌晨|中午|下午|晚上|傍晚)\s*)?(\d{1,2})(?:\s*[:：]\s*(\d{2}))?\s*点/.exec(text);
  if (cn) {
    let hour = Number(cn[2]);
    const minute = cn[3] ? Number(cn[3]) : 0;
    hour = applyPeriod(hour, cn[1]);
    if (!validTime(hour, minute)) return null;
    return { hour, minute, span: cn[0] };
  }
  const clock = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(text);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (clock[3]) hour = applyMeridiem(hour, clock[3]);
    if (!validTime(hour, minute)) return null;
    return { hour, minute, span: clock[0] };
  }
  const en = /(\d{1,2})\s*(am|pm)/i.exec(text);
  if (en) {
    const hour = applyMeridiem(Number(en[1]), en[2]);
    if (!validTime(hour, 0)) return null;
    return { hour, minute: 0, span: en[0] };
  }
  return null;
}

function applyPeriod(hour: number, period?: string): number {
  if (period === "中午") return hour === 12 || hour === 0 ? 12 : hour;
  if (period === "晚上" && hour === 12) return 0;
  if (period && /下午|晚上|傍晚/.test(period) && hour < 12) return hour + 12;
  if (period && /早上|上午|凌晨/.test(period) && hour === 12) return 0;
  return hour;
}

function applyMeridiem(hour: number, meridiem: string): number {
  const pm = meridiem.toLowerCase() === "pm";
  if (pm && hour < 12) return hour + 12;
  if (!pm && hour === 12) return 0;
  return hour;
}

function validTime(hour: number, minute: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function stripScheduleWords(text: string): string {
  return text
    .replace(/\/?(定时|schedule)/gi, " ")
    .replace(/每天|每日|天天|每个工作日|工作日|周一到周五|每周[日天一二三四五六]?/g, " ")
    .replace(
      /every\s+(day|hour|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|fri|sat)|weekdays/gi,
      " ",
    )
    .replace(/早上|上午|凌晨|中午|下午|晚上|傍晚|at/gi, " ")
    .replace(/\d{1,2}(?::\d{2})?\s*(点|am|pm)?/gi, " ")
    .replace(/[，,。.\s]+/g, " ")
    .trim();
}

function pack(cron: string, prompt: string, summary: string): ParsedSchedule {
  const cleaned = prompt || "按计划运行当前工作区任务";
  return {
    name: cleaned.slice(0, 18) || "定时任务",
    cron,
    prompt: cleaned,
    summary,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
