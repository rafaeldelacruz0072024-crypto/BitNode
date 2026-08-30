import type { ImgHTMLAttributes } from "react";

export function BrandMark(props: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      src="/bitnode-logo.png"
      alt="BitNode"
      decoding="async"
      {...props}
    />
  );
}

export default BrandMark;
