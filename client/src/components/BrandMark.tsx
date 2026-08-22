import type { SVGProps } from "react";

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 36" fill="none" aria-hidden="true" focusable="false" {...props}>
      <rect x="1" y="1" width="34" height="34" rx="9" fill="url(#bitnode-mark-bg)" stroke="rgba(149,157,205,.35)" />
      <path d="M10 10h7.2c4.4 0 7 2.1 7 5.4 0 1.7-.8 3.1-2.2 4 1.9.8 3 2.3 3 4.3 0 3.8-2.9 6.3-7.6 6.3H10V10Zm5.2 4.3v5.1h1.8c1.8 0 2.8-.9 2.8-2.6 0-1.7-1-2.5-2.8-2.5h-1.8Zm0 9.1v5.2h2.3c2 0 3.1-.9 3.1-2.7s-1.1-2.5-3.1-2.5h-2.3Z" fill="white" />
      <path d="M28.5 9.5h1.8v20h-1.8z" fill="#6d7cff" opacity=".9" />
      <defs>
        <linearGradient id="bitnode-mark-bg" x1="5" y1="4" x2="31" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#161c43" />
          <stop offset="1" stopColor="#080b18" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default BrandMark;
