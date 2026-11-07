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

/** One song splitting into its stems. */
export const SongTree = icon(
  <>
    <path d="M5 4h14" />
    <path d="M12 7v3" />
    <path d="M6 14v-1c0-2 1-3 3-3h6c2 0 3 1 3 3v1" />
    <path d="M6 17v3M12 17v3M18 17v3" />
  </>,
);

export type IconType = React.ComponentType<IconProps>;
