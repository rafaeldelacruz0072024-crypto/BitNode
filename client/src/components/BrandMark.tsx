import type { SVGProps } from "react";

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 36 36"
      role="img"
      aria-label="BitNode"
      focusable="false"
      {...props}
    >
      <rect x="1" y="1" width="34" height="34" rx="9" fill="#151b3d" stroke="#6d7cff" strokeWidth="1.25" />
      <path d="M10 9.5h7.1c4.45 0 7.1 2.15 7.1 5.45 0 1.78-.82 3.17-2.3 4.05 1.96.82 3.08 2.35 3.08 4.48 0 3.83-2.94 6.52-7.78 6.52H10V9.5Zm4.9 4.1v3.92h2.05c1.65 0 2.55-.68 2.55-2.02 0-1.29-.9-1.9-2.55-1.9H14.9Zm0 7.87v4.4h2.42c1.86 0 2.93-.77 2.93-2.28 0-1.45-1.07-2.12-2.93-2.12H14.9Z" fill="#ffffff" />
      <path d="M28.2 9.5h2v20.5h-2z" fill="#b7ff3c" />
    </svg>
  );
}

export default BrandMark;
