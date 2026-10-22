/* Static import map for documentation MDX pages. Files live in content/docs
 * and are registered here so Next can statically optimize them. */

import type { MDXContent } from "mdx/types";
import GettingStarted from "@/content/docs/getting-started.mdx";
import Installation from "@/content/docs/installation.mdx";
import QuickStart from "@/content/docs/quick-start.mdx";
import CoreConcepts from "@/content/docs/core-concepts.mdx";
import Features from "@/content/docs/features.mdx";
import Architecture from "@/content/docs/architecture.mdx";
import ApiReference from "@/content/docs/api-reference.mdx";
import Configuration from "@/content/docs/configuration.mdx";
import Examples from "@/content/docs/examples.mdx";
import Troubleshooting from "@/content/docs/troubleshooting.mdx";
import Contributing from "@/content/docs/contributing.mdx";

export const MDX_PAGES: Record<string, MDXContent> = {
  "getting-started": GettingStarted,
  installation: Installation,
  "quick-start": QuickStart,
  "core-concepts": CoreConcepts,
  features: Features,
  architecture: Architecture,
  "api-reference": ApiReference,
  configuration: Configuration,
  examples: Examples,
  troubleshooting: Troubleshooting,
  contributing: Contributing,
};
