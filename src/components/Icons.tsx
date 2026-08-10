import {
  ArrowUp,
  CaretDown,
  CaretRight,
  DotsThree,
  File,
  GearSix,
  MagnifyingGlass,
  Minus,
  NotePencil,
  PlugsConnected,
  Plus,
  Pulse,
  SidebarSimple,
  SlidersHorizontal,
  Square,
  X,
} from "@phosphor-icons/react";

type IconProps = { size?: number; className?: string };
const defaults = { weight: "regular" as const, "aria-hidden": true };

export function IconSearch({ size = 14, className }: IconProps) {
  return <MagnifyingGlass {...defaults} size={size} className={className} />;
}
export function IconCompose({ size = 16, className }: IconProps) {
  return <NotePencil {...defaults} size={size} className={className} />;
}
export function IconActivity({ size = 16, className }: IconProps) {
  return <Pulse {...defaults} size={size} className={className} />;
}
export function IconSkills({ size = 16, className }: IconProps) {
  return <SlidersHorizontal {...defaults} size={size} className={className} />;
}
export function IconConnector({ size = 16, className }: IconProps) {
  return <PlugsConnected {...defaults} size={size} className={className} />;
}
export function IconFile({ size = 16, className }: IconProps) {
  return <File {...defaults} size={size} className={className} />;
}
export function IconChevron({ size = 10, className }: IconProps) {
  return <CaretDown {...defaults} size={size} className={className} />;
}
export function IconChevronRight({ size = 11, className }: IconProps) {
  return <CaretRight {...defaults} size={size} className={className} />;
}
export function IconPlus({ size = 13, className }: IconProps) {
  return <Plus {...defaults} size={size} className={className} />;
}
export function IconClose({ size = 10, className }: IconProps) {
  return <X {...defaults} size={size} className={className} />;
}
export function IconPanelRight({ size = 14, className }: IconProps) {
  return <SidebarSimple {...defaults} size={size} className={className} />;
}
export function IconMore({ size = 13, className }: IconProps) {
  return <DotsThree {...defaults} size={size} className={className} weight="bold" />;
}
export function IconSend({ size = 14, className }: IconProps) {
  return <ArrowUp {...defaults} size={size} className={className} weight="bold" />;
}
export function IconGear({ size = 14, className }: IconProps) {
  return <GearSix {...defaults} size={size} className={className} />;
}
export function IconMinimize({ size = 11, className }: IconProps) {
  return <Minus {...defaults} size={size} className={className} />;
}
export function IconMaximize({ size = 11, className }: IconProps) {
  return <Square {...defaults} size={size} className={className} />;
}
export function IconWinClose({ size = 11, className }: IconProps) {
  return <X {...defaults} size={size} className={className} />;
}
