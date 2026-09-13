import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const ModelEditor = lazy(() => import("@/components/editor/ModelEditor"));

const title = "Lovable Modeler — 3D modeling in the browser";
const description =
  "Build 3D scenes with Blender-style tools in your browser and export them as ready-to-use Three.js code.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <>
      <h1 className="sr-only">Lovable Modeler — browser 3D modeling with Three.js export</h1>
      <ClientOnly
        fallback={
          <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
            Loading editor…
          </div>
        }
      >
        <Suspense
          fallback={
            <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
              Loading editor…
            </div>
          }
        >
          <ModelEditor />
        </Suspense>
      </ClientOnly>
    </>
  );
}
