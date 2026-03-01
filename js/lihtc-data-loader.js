// js/lihtc-data-loader.js

// Function to load the Colorado LIHTC dataset
async function loadDataset(url) {
    const response = await fetch(url);
    const data = await response.json();
    return data;
}

// Function to display project counts
function displayProjectCounts(data) {
    const counts = {};
    data.forEach(project => {
        const year = new Date(project.certification).getFullYear();
        counts[year] = (counts[year] || 0) + 1;
    });
    console.log("Project Counts by Year:", counts);
}

// Function to display statistics
function displayStatistics(data) {
    const totalProjects = data.length;
    console.log("Total Projects:", totalProjects);
    // Additional statistics can be computed here as needed
}

// Function for interactive filtering
function filterProjects(data, criteria) {
    return data.filter(project => {
        // Implement filtering logic based on criteria
        return true; // Placeholder, adjust logic as needed
    });
}

export { loadDataset, displayProjectCounts, displayStatistics, filterProjects };