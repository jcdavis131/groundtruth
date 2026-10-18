import Link from "next/link";

export default function DocsNotFound() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-3 max-w-[48rem]">
        Either the identifier in this URL is not one we recognise — a county FIPS code, a CBSA code
        or a two-letter state abbreviation that does not exist — or there is no page at this address
        at all. Nothing is broken and nothing has been withdrawn; the address simply does not
        resolve.
      </p>
      <p className="mt-3 max-w-[48rem]">Start from an index instead:</p>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>
          <Link href="/place" className="underline">
            Counties
          </Link>
        </li>
        <li>
          <Link href="/metro" className="underline">
            Metropolitan areas
          </Link>
        </li>
        <li>
          <Link href="/state" className="underline">
            States
          </Link>
        </li>
      </ul>
    </main>
  );
}
