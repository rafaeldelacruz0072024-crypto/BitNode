import type { HTMLAttributes } from "react";

export function BrandMark(props: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span aria-hidden="true" {...props}>
      B
    </span>
  );
}

export default BrandMark;
