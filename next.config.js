// remark-gfm and rehype-highlight are ESM-only; under CJS require() their
// attachers live under `.default` (interop namespace), not the module itself.
const withMDX = require("@next/mdx")({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [require("remark-gfm").default],
    rehypePlugins: [require("rehype-highlight").default],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions: ["ts", "tsx", "js", "jsx", "mdx"],
  experimental: {
    serverComponentsExternalPackages: ["web-tree-sitter", "tree-sitter-wasms"],
  },
};

module.exports = withMDX(nextConfig);
