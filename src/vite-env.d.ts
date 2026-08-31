/// <reference types="vite/client" />

declare module "katex/contrib/auto-render" {
  interface RenderMathInElementOptions {
    delimiters?: Array<{ left: string; right: string; display?: boolean }>;
    ignoredTags?: string[];
    ignoredClasses?: string[];
    throwOnError?: boolean;
    strict?: boolean | "ignore" | "warn" | "error";
    trust?: boolean;
    macros?: Record<string, string>;
    maxSize?: number;
    maxExpand?: number;
    errorCallback?: (message: string, error: Error) => void;
  }

  export default function renderMathInElement(
    element: HTMLElement,
    options?: RenderMathInElementOptions
  ): void;
}
