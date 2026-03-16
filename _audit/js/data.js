export async function loadData() {

  const allocations = await DataService.getJSON(DataService.baseData("allocations.json"));

  const geo = await DataService.getGeoJSON(DataService.baseMaps("us-states.geojson"));

  return { allocations, geo };
}
