import markUrl from "../assets/herdock-mark.svg";

export function BrandMark({ className }: { className?: string }) {
  return <img className={className} src={markUrl} alt="" aria-hidden="true" draggable={false} />;
}
