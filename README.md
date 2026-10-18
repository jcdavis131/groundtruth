# groundtruth

Every source we collect, on one map, and the same records organized so models and tools can use them.

> "eye is for collecting and storing data in a universal and fun way to connect all of our sources on a map to bring them to life but also for organizing the worlds data for downstream model training and retrieval tools to build smarter systems and tools, first of them being the personal-world-jev"

## Two jobs

1. **The map.** A universal, fun map of every source. A stranger opens it on a phone, finds something they care about, and follows it back to where the data came from. Today that's [eye.jcamd.com](https://eye.jcamd.com), moving here from [gods-eye-view](https://github.com/jcdavis131/gods-eye-view).
2. **The world-data layer.** The same records, with their text and their sources, served to programs in a form they can query and train on, and reproduce later. Its first consumer is personal-world-jev.

A project lives here only if it serves one of these jobs.

## Rules that come with every record

- Every record cites its source: publisher, release and retrieval time.
- Missing means missing. No placeholder or made-up values.
- Public, keyless sources only. No paid APIs.
- No search or embedding of private individuals.
- Large data, caches and model weights don't go in git.

The record and snapshot format these rules apply to is in [data/SCHEMA.md](data/SCHEMA.md). How snapshots are built and read is in [data/PIPELINE.md](data/PIPELINE.md).

## Status

Just created (2026-10-18). Projects move in one at a time, each cut over only after its live checks pass on the new home. The old repos are archived after their cutover.

## License

MIT, as eye was. Each data source keeps its own terms and credit.
