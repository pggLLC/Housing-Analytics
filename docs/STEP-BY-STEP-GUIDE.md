# Refining the Repository for Housing Needs Assessment, Site Selection, and Market Study

## **Objective**
Transform the `Housing-Analytics` repository into a fully functional website that:
1. Serves as a starting point for Housing Needs Assessment (HNA).
2. Includes detailed site selection workflows.
3. Assists in defining a **Market Study** for Colorado jurisdictions.
4. Outputs actionable project recommendations for **winning LIHTC** awards (4% and 9%).
5. Identifies **best rural markets** in Colorado for targeting.

This guide will detail **step-by-step repository cleanup**, restructuring, implementation, and testing workflows.

---

### **I. Repository Cleanup**

#### **1. Reorganizing the Directory Structure**
Reorganize the structure to modularize data, templates, and scripts:
```
Housing-Analytics/
├── /data                 # All processed datasets (GeoJSON, JSON, CSV outputs)
│   ├── census/           # Census tracts, demographic outputs
│   ├── lihtc/            # LIHTC-specific scoring datasets
│   └── geojson/          # All GeoJSON files for GIS rendering
├── /docs                 # Documentation for workflows and methodologies
├── /scripts              # Python, Node.js, and utility scripts
│   ├── fetch_*.py        # Data fetching scripts (HUD, Census APIs)
│   ├── process_*.py      # Post-processing datasets
│   └── validate_*.py     # Unit tests and checks
├── /templates            # HTML templates for rendered pages
├── /css                  # CSS files (styling for all pages)
├── /js                   # JavaScript files (site logic, charts)
├── README.md             # Overview of the project
├── LICENSE.md            # Repository license
```

#### **2. Cleaning up Legacy Files**
- **Check Dependencies:** Remove or revise unused legacy files.
  - Example: Old scripts under `/js` or `/css/legacy`.
- **Optimize Imported Libraries:** Consolidate and minimize external libraries (D3.js, Leaflet, etc.).

#### **3. Set Up Automation**
- Use GitHub Actions to:
  - **Run Tests:** Validate all scripts for data correctness.
  - **Generate Weekly Builds:** Automate datasets refresh (Census API, HUD datasets).
  - **Deploy Static Site:** Automatically deploy changes to GitHub Pages.

---

### **II. Implementation Tasks**

#### **1. Create Key Pages**

The site should have **three key pages** in its workflow:

a) **Housing Needs Assessment (HNA)**:
   - **Purpose:** Identify gaps in affordable housing in Colorado (underserved rural households).
   - **Add Components:**
     - **Demographic Indicators**: Include GIS maps overlaying:
       - Median Income
       - Rent Burden (affordable/unaffordable distinctions)
     - Regional/Census-tract-level heatmaps
   - **Methodology:**
     - Calculate population *vs* affordable housing supply ratios.
     - Pull HUD LIHTC datasets for local allocations.

b) **Site Selection:**
   - **Purpose:** Help developers evaluate LIHTC project locations.
   - **Interactive Tools to Add:**
     - GIS map overlays for potential rural sites.
     - Tract-specific factors:
       - Unmet AMI housing need (30%-60% AMI).
       - Transit connection scores.
   - **Call APIs:** Use Census Bureau’s ACS APIs to evaluate tract-level median gross rent.

c) **Market Study Analytics**:
   - **Visual Layout:**
     - Start broad (state, county-level).
     - Narrow to tracts.
   - **Key Features:**
     - Project Feasibility Score:
       - Development cost per unit.
       - Financial viability (HUD debt).
       - Market absorption.

---

#### **2. Add Navigation Workflow**
The website should flow naturally:
1. **Starts with HNA** → **proceed to Site Selection** → **ends with Market Study analytics and project recommendations**.
2. Highlight dropdown menus for statewide/rural data toggles.

---

### **III. Methodology for Calculations**

**1. HNA (Housing Needs Assessment)**
- Inputs:
  - **Median Income vs. Gross Rent** (ACS DP04 tables).
  - **Vacancy Rates**.
- Outputs:
  - Maps showing **affordable units** deficits.

**2. 4% or 9% LIHTC Feasibility:**
- Use sample Qualified Allocation Plan (QAP) scoring:
  - Development targeting <80% AMI wins higher points.
  - Calculate economies of scale (cost per unit).

**3. Underserved Market Analysis:**
- Use FRED and Census APIs to target growth regions with unmet LIHTC saturation.

---

### **IV. Testing and Debugging**

#### Key Areas to Test:
1. **GIS Rendering:** Ensure counties/tracks load properly on maps.
2. **API Errors:** Use robust error-handling logic for API timeouts.
3. **User Experience Validation:** Employ WCAG guidelines for accessibility.

---

### **V. Copy-Paste Section for ChatGPT/Claude**

Here’s a prompt you can run in ChatGPT or Claude to verify and implement the steps:

```
I have a GitHub repository [https://github.com/pggLLC/Housing-Analytics] that needs to become a functional website for affordable housing analytics. Specifically:

1. Refactor the repo to create a workflow for:
   - **Housing Needs Assessment** (HNA): Uncover unmet housing needs.
   - **Site Selection**: Help identify LIHTC project sites.
   - **Market Study**: Define jurisdiction-specific market feasibility.
2. Add components for:
   - LIHTC Project Feasibility Scores
   - Underserved markets analysis in rural Colorado.
3. Reorganize the directory into `/data`, `/css`, `/js`, and `/templates`.
4. Ensure workflows align with the proper methodology:
   - Use Median Income, Rent, LIHTC allocations.
5. Automate testing of GIS data and API pull-failures.
6. Deploy changes as a **GitHub Pages website.**
```

---