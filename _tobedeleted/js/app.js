import { loadData } from "./data.js";
import { computeMetrics } from "./metrics.js";

const stateFilter = document.getElementById("stateFilter");
const programFilter = document.getElementById("programFilter");

init();

async function init() {

  try {
    const { allocations } = await loadData();

    populateStates(allocations);
    updateDashboard(allocations);

    stateFilter.onchange = () =>
      updateDashboard(filterData(allocations));

    programFilter.onchange = () =>
      updateDashboard(filterData(allocations));

    document.getElementById("updated").innerText =
      "Updated: " + new Date().toLocaleDateString();

  } catch (e) {
    console.error("Initialization failed:", e);
    alert("Data failed to load.");
  }
}

function populateStates(data) {
  const states = [...new Set(data.map(d => d.state))];

  stateFilter.innerHTML =
    `<option value="all">All</option>` +
    states.map(s => `<option>${s}</option>` .join("");
}

function filterData(data) {

  return data.filter(d => {

    if (stateFilter.value !== "all" &&
        d.state !== stateFilter.value) return false;

    if (programFilter.value !== "all" &&
        d.program !== programFilter.value) return false;

    return true;
  });
}

function updateDashboard(data) {

  const m = computeMetrics(data);

  document.getElementById("totalUnits").innerText =
    m.totalUnits.toLocaleString();

  document.getElementById("projectCount").innerText =
    m.projectCount;

  document.getElementById("creditsPerUnit").innerText =
    "$" + Math.round(m.creditsPerUnit).toLocaleString();

  drawChart(data);
}

function drawChart(data) {

  const svg = d3.select("#chart");
  svg.selectAll("*").remove();

  const x = d3.scaleBand()
    .domain(data.map(d => d.year))
    .range([40, 850])
    .padding(0.2);

  const y = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.units)])
    .range([400, 20]);

  svg.append("g")
    .attr("transform", "translate(0,400)")
    .call(d3.axisBottom(x));

  svg.append("g")
    .attr("transform", "translate(40,0)")
    .call(d3.axisLeft(y));

  svg.selectAll("rect")
    .data(data)
    .enter()
    .append("rect")
    .attr("x", d => x(d.year))
    .attr("y", d => y(d.units))
    .attr("width", x.bandwidth())
    .attr("height", d => 400 - y(d.units));
}
