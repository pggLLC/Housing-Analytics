export async function loadData() {

  const base = window.location.pathname.includes("github.io")
    ? "/lihtc-analytics-hub"
    : "";

  const allocations = await fetch(`${base}/data/allocations.json`)
    .then(r => {
      if (!r.ok) throw new Error("Allocations failed");
      return r.json();
    });

  const geo = await fetch(`${base}/maps/us-states.geojson`)
    .then(r => r.json());

  return { allocations, geo };
}
