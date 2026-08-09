/** Line icons transcribed from the 行知 Agent 工作台 handoff (16px grid, 1.5 stroke). */
type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function IconSearch({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="7" cy="7" r="4.6" />
      <line x1="10.4" y1="10.4" x2="13.6" y2="13.6" />
    </svg>
  );
}

export function IconCompose({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9.6 2.6H3.4a1.2 1.2 0 0 0-1.2 1.2v8.6a1.2 1.2 0 0 0 1.2 1.2h8.6a1.2 1.2 0 0 0 1.2-1.2V6.4" />
      <path d="M12.2 1.9a1.3 1.3 0 0 1 1.9 1.9L8.2 9.7l-2.5.6.6-2.5z" />
    </svg>
  );
}

export function IconActivity({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M1.8 8h3l1.6-4.4 2.4 8.8 1.7-4.4h3.3" />
    </svg>
  );
}

export function IconSkills({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2 4.5h5M11 4.5h3M2 11.5h3M9 11.5h5" />
      <circle cx="9" cy="4.5" r="2" />
      <circle cx="7" cy="11.5" r="2" />
    </svg>
  );
}

export function IconConnector({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6.4 9.6 9.6 6.4" />
      <path d="M9 4.4 10.4 3a2.9 2.9 0 0 1 4.1 4.1L13.1 8.5M7 11.6 5.6 13a2.9 2.9 0 0 1-4.1-4.1L2.9 7.5" />
    </svg>
  );
}

export function IconFile({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 1.8H4.2a1.2 1.2 0 0 0-1.2 1.2v10a1.2 1.2 0 0 0 1.2 1.2h7.6a1.2 1.2 0 0 0 1.2-1.2V5.8z" />
      <path d="M9 1.8v4h4" />
    </svg>
  );
}

export function IconChevron({ size = 10, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.9}>
      <polyline points="4,6.5 8,10.5 12,6.5" />
    </svg>
  );
}

export function IconChevronRight({ size = 11, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.8}>
      <polyline points="6.5,3.5 11,8 6.5,12.5" />
    </svg>
  );
}

export function IconPlus({ size = 13, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.7}>
      <path d="M8 3.6v8.8M3.6 8h8.8" />
    </svg>
  );
}

export function IconClose({ size = 10, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.7}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconPanelRight({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2" />
      <line x1="10.2" y1="2.8" x2="10.2" y2="13.2" />
    </svg>
  );
}

export function IconMore({ size = 13, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.6}>
      <circle cx="3.4" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12.6" cy="8" r="1" />
    </svg>
  );
}

export function IconSend({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.8} stroke="#fff">
      <path d="M8 13V3.5" />
      <polyline points="3.8,7.7 8,3.4 12.2,7.7" />
    </svg>
  );
}

export function IconLock({ size = 10, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.6}>
      <rect x="3" y="7" width="10" height="7" rx="1.6" />
      <path d="M5.4 7V4.8a2.6 2.6 0 0 1 5.2 0V7" />
    </svg>
  );
}

export function IconGear({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.4}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3" />
    </svg>
  );
}

export function IconMinimize({ size = 11, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.2}>
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  );
}

export function IconMaximize({ size = 11, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.2}>
      <rect x="3.5" y="3.5" width="9" height="9" />
    </svg>
  );
}

export function IconWinClose({ size = 11, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.2}>
      <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
      <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
    </svg>
  );
}
