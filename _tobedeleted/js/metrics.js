export function computeMetrics(data) {

  const totalUnits = d3.sum(data, d => d.units);
  const totalCredits = d3.sum(data, d => d.credits);

  return {
    totalUnits,
    projectCount: data.length,
    creditsPerUnit: totalCredits / totalUnits
  };
}
