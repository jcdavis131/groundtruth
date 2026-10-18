# Examples

Use the Embedding Atlas data without the globe: a Python client, a notebook, and the MCP server for agents. Everything here talks to the same keyless, CORS-open `/api` routes the globe uses; nothing is computed client-side that the API does not already publish with its source.

## Point at a server

All three default to `http://localhost:3000` (run `npm run dev` in the repository root). To use the hosted app instead:

```bash
export GEV_BASE_URL=https://eye.jcamd.com
```

## Python client (`gev.py`)

Dependency-free (urllib only); pandas is optional and only imported by `to_dataframe()`.

```python
import sys; sys.path.append("examples")   # or copy gev.py next to your script
from gev import report, areas, series, screen, citations, to_dataframe

r = report(-97.75, 30.3)                          # market report for a point (Austin)
w = report(-98.49, 29.42, kind="water")           # water report (San Antonio)
tx = to_dataframe(areas("-106.7,25.8,-93.5,36.5")["data"]["features"])   # Texas counties
s = series("fred:MORTGAGE30US", from_="2020-01-01")
hits = screen("county", "home.yoyPct > 5 AND jobs.yoy.emp < 0 SORT momentum DESC LIMIT 25")
print("\n".join(citations(r)))
```

Routes added in this build (`/api/series`, `/api/screen`, `/api/indicators`, `/api/releases`, `/api/economy/history`, `/api/companies`, `/api/finance`) raise `GevError(404, ...)` on a server that does not have them yet; the notebook shows how to skip those cells.

## Notebook (`embedding_atlas.ipynb`)

```bash
pip install jupyter pandas matplotlib      # the only extras
export GEV_BASE_URL=https://eye.jcamd.com  # or leave unset with npm run dev running
jupyter lab examples/embedding_atlas.ipynb
```

It pulls the Texas counties into pandas, plots home-value yoy against wage yoy, reads Travis County's momentum history, runs a screen, reads the Mississippi-at-Memphis indicator history, and prints the citations from each response's `provenance`. The notebook ships with no outputs; run it top to bottom. Each markdown cell says what the numbers are and what they are not (Zillow values are model estimates; QCEW withheld cells are null; momentum and affordability are estimates with the formula in the payload).

## MCP server

The API is also a [Model Context Protocol](https://modelcontextprotocol.io) server: 24 read-only tools (`water_report`, `market_report`, `areas`, `sectors`, `ports`, `gauges`, `series_get`, `screen`, `indicators`, `company`, ...), the docs and the OpenAPI document as resources, and three prompts (county due diligence, port congestion check, water stress brief). The full tool table is in [docs/MCP.md](../docs/MCP.md).

### Claude Code

Local (stdio; the script compiles `lib/mcp` on first run and calls the API at `GEV_BASE_URL`):

```bash
claude mcp add gev -- node scripts/mcp-stdio.mjs
# against the hosted API instead of a local dev server:
claude mcp add gev -e GEV_BASE_URL=https://eye.jcamd.com -- node scripts/mcp-stdio.mjs
```

Remote (Streamable HTTP, no auth):

```bash
claude mcp add --transport http gev https://eye.jcamd.com/api/mcp
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gev": {
      "command": "node",
      "args": ["/absolute/path/to/gods-eye-view/scripts/mcp-stdio.mjs"],
      "env": { "GEV_BASE_URL": "https://eye.jcamd.com" }
    }
  }
}
```

Or add `https://eye.jcamd.com/api/mcp` as a remote server where the client supports Streamable HTTP without OAuth.

### Inspect it

```bash
npx @modelcontextprotocol/inspector node scripts/mcp-stdio.mjs
node scripts/mcp-stdio.mjs --manifest     # tool list as JSON
node scripts/mcp-stdio.mjs --doc-table    # the markdown table in docs/MCP.md
```

### curl

The HTTP endpoint is stateless JSON-RPC: no session header, no SSE.

```bash
# what is there
curl -s "$GEV_BASE_URL/api/mcp" | jq '.tools[].name'

# initialize (required by the protocol, harmless to repeat since nothing is stored)
curl -s "$GEV_BASE_URL/api/mcp" -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"initialize",
  "params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# list tools
curl -s "$GEV_BASE_URL/api/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq '.result.tools[] | {name, title}'

# call one
curl -s "$GEV_BASE_URL/api/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"sectors","arguments":{"fips":"48453"}}}' \
  | jq '.result.structuredContent.data.sectors[:5]'

# a prompt, rendered
curl -s "$GEV_BASE_URL/api/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"water_stress_brief","arguments":{"lon":"-98.49","lat":"29.42"}}}' \
  | jq -r '.result.messages[0].content.text'

# a resource
curl -s "$GEV_BASE_URL/api/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"gev://docs/MCP.md"}}' | jq -r '.result.contents[0].text' | head
```

The plain HTTP API needs none of that:

```bash
curl -s "$GEV_BASE_URL/api/economy?op=report&lon=-97.75&lat=30.3" | jq '.data.home'
curl -s "$GEV_BASE_URL/api/water?op=history&site=USGS-07032000&param=00065" | jq '.data[-5:]'
```

## Terms

The routes rate-gate and cache on the upstreams' behalf; please do not fan out thousands of report calls. Every response names its source; keep the attribution when you publish. No people: the API and these tools return aggregates and public institutional records only.
