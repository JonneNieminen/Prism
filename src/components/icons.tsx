import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & { size?: number | string };

/** Custom icons drawn to match lucide (24 grid, 1.75 round stroke) and take the same props. */
function icon(paths: React.ReactNode) {
  return function Icon({ size = 24, ...rest }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
        {paths}
      </svg>
    );
  };
}

/** Stems stacked like layers of the mix. */
export const StackedStems = icon(
  <>
    <rect x="4" y="4" width="10" height="4" rx="2" />
    <rect x="8" y="10" width="12" height="4" rx="2" />
    <rect x="4" y="16" width="8" height="4" rx="2" />
  </>,
);

export type IconType = React.ComponentType<IconProps>;
