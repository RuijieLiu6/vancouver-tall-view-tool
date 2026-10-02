# Vancouver View-Protection Lab

**[Open the tool in your browser](https://ruijieliu6.github.io/vancouver-tall-view-tool/)** · [Report an issue or a review](https://github.com/RuijieLiu6/vancouver-tall-view-tool/issues/new) · ARCH 540, Assignment 1 · release v09 (October 2026)

![Demo: site, build, view and output](media/demo.gif)

## 1. Purpose

<!-- Ruijie: write the Purpose yourself (150 words or fewer): what the tool helps someone understand or do, and for whom. -->
*Purpose to be written by Ruijie Liu.*

## 2. How to use it

The tool is a web page; it needs no installation. Open the link above in a desktop browser with WebGL2 (recent Chrome, Edge, Firefox or Safari). The first visit shows a short introduction; **Help** in the top bar opens it again.

The tool works in four steps. In each step you choose one method; the panel then offers the other methods as buttons if you want to switch, **Proceed** moves on and **Return** goes back.

1. **Site.** *Open spot on the plan*: find the area with a neighbourhood or a downtown address (suggestions appear as you type), then click open ground or draw a boundary. *Replace a building* or *Replace several buildings*: click buildings in the plan, then use them as the site.
2. **Build.** *Build on the platform*: stack and size blocks (height, width, depth, rotation, offsets). *Import a model*: a Rhino `.3dm` or `.obj` file, read on your device. Existing buildings under the proposal are shown as demolished; a checkbox keeps them.
3. **View.** *View from a protected cone*: stand at the City's open-data origin of one of the 24 protected views. *View from a building*: stand on a modelled roof. *Drag and view*: press a spot in the plan, drag toward what you want to see and release. The small plan inset shows where you stand and which way you look.
4. **Output.** See which mapped view corridors overlap the proposal in plan, optionally test a study ceiling, then choose the **PDF contents** and **Export PDF**. Every protected view whose corridor overlaps the proposal gets a page with existing and proposed views from its origin point, a key plan and a section. **Start a new study** clears everything.

**Style** in the top bar switches between Studio, Illustrated garden, Landscape collage and Night. **Layers** adds labels, roads and an experimental 2022 aerial photo texture.

## 3. Source

- City of Vancouver, *Public Views Guidelines*, approved by Council July 10, 2024, last amended February 4, 2026.
  - Section 2, Application and Intent (p.3): a protected view is an origin point, view cones with two vertical boundaries, and a horizontal lower boundary (the maximum height).
  - Section 3.1, Table 1 (pp.4–6): the protected public views, their origin points and subjects.
  - Clause 3.1.1 (p.6): no part of a building should encroach into the relevant view cones. Clauses 3.1.2 to 3.1.5 (pp.6–7) are shown as text for people to judge.
- City of Vancouver open data, [view-cones](https://opendata.vancouver.ca/explore/dataset/view-cones/) (plan polygons only; the cone heights are not in this dataset).

The tool computes the plan relation between your proposal and each mapped corridor, renders each view from its open-data origin, and compares the proposal with a height *you* set. It does not test the City's cone heights, view shadows (3.3) or Exceptional Downtown Sites (3.4).

## 4. One example

![Example: the 120 m tower seen from a nearby roof](media/example-rooftop-view.png)

**Input.** Site at Georgia and Cambie (model x 700, y −300). One block: 120 m tall, 30 × 30 m, rotation 0°. View from the roof of the modelled building `w363410790`, 389 m away, eye 1.6 m above the roof. Study ceiling: 100 m above the proposal base.

**Result.** Three mapped view corridors overlap the proposal in plan: 3.2.3 Queen Elizabeth Park, 9.2 Cambie Street and A Alder Terrace. The height experiment reads **20.0 m above your study ceiling**; lowering the tower to 80 m reads **20.0 m below your study ceiling**. To reproduce it, click **See a worked example** on the intro (or **Open a worked example** in step 1), or open [`media/example-study.json`](media/example-study.json) with **Study file › Open study**.

## 5. Skill and limits

- Building heights come from OpenStreetMap and the supplied model and are unverified; the model's vertical datum is unknown. Terrain is approximate (60 m SRTM).
- View-cone heights are not in the open data, so the tool cannot show whether a building rises into a cone. Plan overlap and the study ceiling are not a City assessment.
- Study boundaries and replaced-building outlines are approximate model outlines, not legal parcels.
- Rendered views are exploratory, not verified sightlines. Imported models are checked by their part bounding boxes.
- The address box sends what you type to the City of Vancouver open-data portal (once, to load downtown addresses) and to the BC Address Geocoder for suggestions. The aerial texture loads City orthophoto tiles. Studies and PDF reports are made on your device and are not uploaded.
- A person must check any result against the City's by-laws and the Public Views Guidelines.

## Sources and attribution

- View cones and 2022 orthophotos: City of Vancouver Open Data, [Open Government Licence – Vancouver](https://opendata.vancouver.ca/pages/licence/). City civic addresses: [property-addresses](https://opendata.vancouver.ca/explore/dataset/property-addresses/), same licence.
- Address geocoding: © Province of British Columbia, [BC Address Geocoder](https://digital.gov.bc.ca/bcgov-common-components/bc-address-geocoder/), [Open Government Licence – British Columbia](https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc).
- Streets, water, parks and simplified buildings outside the supplied model: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL](https://opendatacommons.org/licenses/odbl/). Terrain and mountains: NASA SRTM via [Open Topo Data](https://www.opentopodata.org/).
- The central Vancouver context is a derived browser export of a supplied studio Rhino model; the original `.3dm` file is not included. Interface type: [Inter](https://rsms.me/inter/) (SIL Open Font Licence).

This bundle is generated with `tools/build_pages.py` from a private working project; `release-manifest.json` lists every file with its size and SHA-256 hash.
