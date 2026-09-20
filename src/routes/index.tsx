import { createFileRoute } from "@tanstack/react-router";
import { RepoSherlockApp } from "@/components/reposherlock/RepoSherlockApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RepoSherlock — Investigate before you code" },
      {
        name: "description",
        content:
          "An evidence-backed software engineering investigation workspace for understanding unfamiliar repositories.",
      },
      { property: "og:title", content: "RepoSherlock — Investigate before you code" },
      {
        property: "og:description",
        content:
          "Trace root causes, verify evidence, understand impact, and build a confident fix plan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RepoSherlockApp,
});
