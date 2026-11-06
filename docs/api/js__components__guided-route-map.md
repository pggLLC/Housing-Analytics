# `js/components/guided-route-map.js`

guided-route-map.js — the whole guided path on one screen, before step 1.

The rail shows where a reader is; this shows where the path goes and what
each stop answers, for the product they chose. Every label, link and swap
comes from WorkflowProgress.stepsFor(product), the same list the rail and
the next-step banner use, so the map cannot name a step the rail does not.

  GuidedRouteMap.render(mountEl, product)   // product: a WorkflowProgress product key
  GuidedRouteMap.html(steps, productLabel)  // pure, for tests

_No documented symbols — module has a file-header comment only._
