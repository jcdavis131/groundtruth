"use client";
// The front door: a real search form and a plain link to the catalogue, in the
// server HTML so a phone and a crawler get them before any JavaScript runs.
// Without JavaScript the form lands on /catalog; once the page is live a tap
// opens the search palette, and Enter carries what was typed into it.

import { useId } from "react";
import { Search } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";

export function SiteSearch({ className = "" }: { className?: string }) {
  const setSearchOpen = useGlobe((s) => s.setSearchOpen);
  const id = useId();
  return (
    <form
      role="search"
      action="/catalog"
      method="get"
      className={`relative flex min-w-0 items-center ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement | null;
        setSearchOpen(true, input?.value.trim() ?? "");
        if (input) input.value = "";
      }}
    >
      <label htmlFor={id} className="sr-only">
        Search places, records and layers
      </label>
      <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden />
      <input
        id={id}
        type="search"
        name="q"
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Search a place or record"
        // A tap or click opens the palette straight away (no focus, so a phone
        // does not zoom into this field first); the keyboard types here and
        // Enter hands the text over.
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          setSearchOpen(true, e.currentTarget.value.trim());
        }}
        className="h-11 w-full min-w-0 rounded-md border border-border bg-background/80 pl-9 pr-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
    </form>
  );
}

/** A plain link: the catalogue is the other root layout, so this is a full navigation anyway. */
export function CatalogLink({ className = "" }: { className?: string }) {
  return (
    <a
      href="/catalog"
      className={`flex h-11 shrink-0 items-center px-2 text-[13px] text-foreground underline underline-offset-4 hover:text-primary ${className}`}
    >
      Catalogue
    </a>
  );
}
