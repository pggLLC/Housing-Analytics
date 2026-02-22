// Navigation functionality for the Housing Analytics application

// Function to initialize and manage the navigation menu
function initNavigation() {
    const menuToggle = document.getElementById('menu-toggle');
    const menu = document.getElementById('navigation-menu');

    // Toggle menu visibility
    menuToggle.addEventListener('click', () => {
        menu.classList.toggle('visible');
    });
}

// Function to handle navigation link clicks
function handleNavigation() {
    const links = document.querySelectorAll('#navigation-menu a');
    links.forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            const targetPage = link.getAttribute('href');
            loadPage(targetPage); // Function to load the respective page
        });
    });
}

// Function to load the respective page content
function loadPage(page) {
    // Logic to load page content goes here
    console.log('Loading page:', page);
}

// Initialize navigation when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    handleNavigation();
});