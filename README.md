# Vancouver View-Protection Lab

[Open the tool in your browser](https://ruijieliu6.github.io/vancouver-tall-view-tool/)

Explore a proposed building in a visual Vancouver context. No installation is needed. The [Synthetic checker](https://ruijieliu6.github.io/vancouver-tall-view-tool/synthetic/) demonstrates a separate box-versus-boundary comparison on test fixtures.

This is an ARCH 540 studio teaching tool, not a City of Vancouver assessment. View-cone polygons show plan boundaries; the published data does not supply their protected heights. The optional study ceiling is a user-entered design assumption. The terrain, context buildings and imported-model bounding boxes are approximate. Do not use the output for permitting or policy conclusions.

The site runs entirely in your browser. Study JSON and PDF reports are created on your device; no project file is uploaded to a server. The static site includes derived scene geometry and the view-cone data used for the on-screen context. The public JavaScript, CSS, and page files are in `explorer/` and `synthetic/`.

## Sources and attribution

- View-cone plan polygons: [City of Vancouver Open Data Portal](https://opendata.vancouver.ca/explore/dataset/view-cones/), under the [Open Government Licence – Vancouver](https://opendata.vancouver.ca/pages/licence/). The City's bylaws remain authoritative.
- Public Views Guidelines: [City of Vancouver](https://vancouver.ca/home-property-development/protecting-vancouvers-views.aspx). The page displays attributed clause excerpts and source pages in the guideline data.
- Surrounding streets, water, parks and simplified buildings: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL](https://opendatacommons.org/licenses/odbl/).
- Approximate terrain and mountain backdrop: NASA SRTM, served through [Open Topo Data](https://www.opentopodata.org/).
- The central Vancouver context is a derived browser export of a supplied studio Rhino model. The original `.3dm` source model is not included here.

For data provenance and limits, see `generated/manifest.json`, `generated/extension_manifest.json`, `generated/backdrop_manifest.json`, `generated/unified_manifest.json`, and `data/viewcones.json`.

This standalone publication bundle is generated locally with `tools/build_pages.py` from the private working project. `release-manifest.json` lists the bundled source and data files, their sizes, and SHA-256 hashes. The GitHub Pages workflow in `.github/workflows/pages.yml` uploads these prebuilt files; it does not access the private project.
