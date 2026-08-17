import type { ReactNode, SVGProps } from "react";

type IconProps = {
  size?: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "viewBox" | "width" | "height">;

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Frame({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      overflow="visible"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** New chat — plus inside a rounded tile so the primary action has mass. */
export function SidebarIconPlus({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <rect x="4" y="4" width="16" height="16" rx="4" {...STROKE} />
      <path d="M12 8.2v7.6M8.2 12h7.6" {...STROKE} />
    </Frame>
  );
}

export function SidebarIconPlusBare({ size = 16, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <path d="M12 5.5v13M5.5 12h13" {...STROKE} />
    </Frame>
  );
}

/** Design canvas: artboard with two layout rules. */
export function SidebarIconDesign({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" {...STROKE} />
      <path d="M7.5 9.2h9M7.5 13h5.5" {...STROKE} />
    </Frame>
  );
}

/** Session history: clock. */
export function SidebarIconHistory({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <circle cx="12" cy="12" r="8" {...STROKE} />
      <path d="M12 7.8V12l3.2 2" {...STROKE} />
    </Frame>
  );
}

/** Live activity: pulse. */
export function SidebarIconActivity({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <path d="M3 12.5h3.2l2.3-6.2 3.4 11.4 2.6-5.2H21" {...STROKE} />
    </Frame>
  );
}

/** Approvals: shield with a check. */
export function SidebarIconApprovals({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <path d="M12 3.6 19 6.6v5.3c0 4.1-2.9 7-7 8.5-4.1-1.5-7-4.4-7-8.5V6.6l7-3z" {...STROKE} />
      <path d="M8.6 12.2 11 14.5l4.6-4.8" {...STROKE} />
    </Frame>
  );
}

/** Usage: three bars. */
export function SidebarIconUsage({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <path d="M6.2 16.8V11M12 16.8V6.2M17.8 16.8v-3.6" {...STROKE} />
      <path d="M4.5 19h15" {...STROKE} />
    </Frame>
  );
}

/** Skills: four-point spark. */
export function SidebarIconSkills({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <path d="M13.4 3.4 6 13.2h5.4l-1.2 7.4 7.6-10.2h-5.4L13.4 3.4z" {...STROKE} />
    </Frame>
  );
}

/** MCP: two-prong plug. */
export function SidebarIconMcp({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <path d="M8.2 4.4v4M15.8 4.4v4" {...STROKE} />
      <rect x="6" y="8.4" width="12" height="7.6" rx="2.4" {...STROKE} />
      <path d="M12 16v4.2" {...STROKE} />
    </Frame>
  );
}

/** Artifacts: stacked layers. */
export function SidebarIconArtifacts({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <path d="M4.2 8.4 12 4.6l7.8 3.8L12 12.2 4.2 8.4z" {...STROKE} />
      <path d="M4.2 12.2 12 16l7.8-3.8" {...STROKE} />
      <path d="M4.2 15.8 12 19.6 19.8 15.8" {...STROKE} />
    </Frame>
  );
}

export function SidebarIconSearch({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <circle cx="11" cy="11" r="6.4" {...STROKE} />
      <path d="M16.2 16.2 21 21" {...STROKE} />
    </Frame>
  );
}

export function SidebarIconPanel({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" {...STROKE} />
      <path d="M9.2 4.5v15" {...STROKE} />
    </Frame>
  );
}

export function SidebarIconGear({ size = 18, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <circle cx="12" cy="12" r="3.1" {...STROKE} />
      <path
        d="M12 4.2v2.1M12 17.7v2.1M4.2 12h2.1M17.7 12h2.1M6.4 6.4l1.5 1.5M16.1 16.1l1.5 1.5M17.6 6.4l-1.5 1.5M7.9 16.1l-1.5 1.5"
        {...STROKE}
      />
    </Frame>
  );
}

export function SidebarIconDots({ size = 16, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <circle cx="6" cy="12" r="1.85" fill="currentColor" />
      <circle cx="12" cy="12" r="1.85" fill="currentColor" />
      <circle cx="18" cy="12" r="1.85" fill="currentColor" />
    </Frame>
  );
}

export function SidebarIconCaret({ size = 14, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <path d="M7 9.2 12 14.8 17 9.2" {...STROKE} />
    </Frame>
  );
}

export function SidebarIconTrash({ size = 16, ...rest }: IconProps) {
  return (
    <Frame size={size} {...rest}>
      <path d="M5 7.5h14" {...STROKE} />
      <path d="M9.2 4.6h5.6" {...STROKE} />
      <path d="M7.2 7.5l.9 12.2h7.8l.9-12.2" {...STROKE} />
      <path d="M10.2 11v5.2M13.8 11v5.2" {...STROKE} />
    </Frame>
  );
}
