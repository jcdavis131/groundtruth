import NotFoundFrame from "@/components/hud/NotFoundFrame";

// The globe root layout is dark, full-height and overflow-hidden; a 404 raised
// inside it is the same composed frame as the app-wide one.
export default function GlobeNotFound() {
  return (
    <>
      <title>Not found · Embedding Atlas</title>
      <NotFoundFrame />
    </>
  );
}
