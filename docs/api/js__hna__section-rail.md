# `js/hna/section-rail.js`

Contents rail for the Housing Needs Assessment.

The page runs 54 sections across roughly 53 desktop screens — about 112 on
a phone — with no table of contents and only five jump links. A reader who
wants Prop 123 compliance, or bedroom mix, or the permit history has one
tool available: scrolling past dozens of sections they did not ask for.

The rail is deliberately additive. It reorders nothing, renames nothing and
computes nothing — it reads the headings already in the document and builds
navigation from them, so it carries none of the regression risk that
resequencing the sections would (freshness checks, anchors, the PDF export).

Two decisions worth recording:

1. Entries are listed in DOCUMENT order, not grouped by subject. Grouping
   would better reflect how the page *should* read, but the highlight
   follows the reader's scroll, and a grouped rail would make it jump
   between groups as they scroll linearly. Navigation must describe the
   page that exists, not the one we would like to exist.

2. Labels are taken from a CLONE of each heading with its methodology
   disclosure stripped. Around eight headings embed their tooltip inside
   the <h2>, so their raw textContent reads "Housing stock by structure
   typeℹ️ MethodologyWhat it measuresDistribution…". Using that verbatim
   would produce a rail of paragraphs.

## Symbols

### `cleanLabel(heading)`

Strip the methodology/tooltip furniture that lives inside some headings.

### `collect(doc)`

collect — find the headings worth navigating to.
Exported for tests: given a document, returns [{id, label, heading}].

### `buildPath(doc)`

buildPath — render the guided reading path, or nothing if the module is
absent or too few stops survive. A two-stop "path" is not a path; below
that threshold the full contents list is the better affordance.

### `ensureShell(doc)`

Put <main> and the rail in a shared grid container.

The rail used to be position:fixed at left: max(.75rem, 50vw - 46rem),
which meant it did not participate in layout at all -- content had to be
padded out of its way, and the two pieces of viewport arithmetic had to
agree. Below ~1712px they stop agreeing: at 1440px the rail spans 12-252px
while the centred 1240px main column starts at 100px, so the rail sat on
top of it. The workaround was `padding-inline: 11rem` on the view switcher,
which is why the switcher drifted whenever anything else about the width
changed.

In a grid the rail owns a track, so overlap is not avoided -- it is
impossible, at every width, with no arithmetic to keep in sync.

This runs EARLY, before the section renderers populate <main>. Reparenting
a <main> that already contains initialised Leaflet maps and charts would
re-run layout on all of them, and a map whose container is re-measured
mid-life is exactly the class of bug that makes tiles disappear. Wrapping
an empty shell costs nothing and avoids that entirely.
